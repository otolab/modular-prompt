# Harmony形式レスポンスの後処理設計

## Context

llm-jp-4モデルはOpenAIのHarmony Response Formatを採用している。`-instruct` と `-thinking` バリアントがあり、スペシャルトークンによるチャネル分離（analysis/final/tool_call）が特徴。

MLX変換モデル（`mlx-community/llm-jp-4-8b-thinking-4bit`等）をmodular-promptのMLXドライバーで利用する場合、レスポンスの後処理が必要になる。

### Harmonyフォーマットの構造

```
<|start|>{role}<|channel|>{channel_type}<|message|>{content}<|end|>
```

スペシャルトークン一覧:

| トークン | 用途 |
|---------|------|
| `<\|start\|>` | メッセージ開始 |
| `<\|end\|>` | メッセージ終了 |
| `<\|return\|>` | 生成終了（EOS相当） |
| `<\|channel\|>` | チャネル指定開始 |
| `<\|message\|>` | メッセージ本文開始 |
| `<\|call\|>` | ツール呼び出し終了 |
| `<\|constrain\|>` | 制約指定 |

チャネルの種類:

| チャネル | 用途 | 対応するQueryResult |
|---------|------|-------------------|
| `analysis` | 内部推論（thinking） | → `thinkingContent` (新設) |
| `final` | ユーザーへの最終回答 | → `content` |
| `commentary to=functions.{name}` | ツール呼び出し | → `toolCalls` |

### レスポンス例

```
<|start|>assistant<|channel|>analysis<|message|>ユーザーは天気を聞いている...<|end|>
<|start|>assistant<|channel|>final<|message|>今日の東京は晴れです。<|end|>
```

thinkingからtool callを経て最終回答に至る例:
```
<|start|>assistant<|channel|>analysis<|message|>天気APIを呼ぶ必要がある<|end|>
<|start|>assistant to=functions.get_weather<|channel|>commentary json<|message|>{"location":"Tokyo"}<|call|>
<|start|>functions.get_weather to=assistant<|channel|>commentary<|message|>"sunny, 25°C"<|end|>
<|start|>assistant<|channel|>final<|message|>東京は晴れ、25°Cです。<|end|>
```

## 設計方針

### 原則

1. **後処理はTypeScriptに寄せる** — Python側はchat template適用とトークン生成のみ
2. **モデル固有の分岐は許容する** — モデル名ベースのハンドラ選択は既存パターン（gemma-3/4）に倣う
3. **既存のQueryResult/QueryOptionsを拡張する** — Harmony固有の型は作らず共通型に統合

### 変更対象

#### 1. QueryOptions: `reasoningEffort` の追加

現状 `reasoningEffort` はOpenAIドライバーのローカル型にのみ存在する。これを共通の `QueryOptions` に昇格する。

```typescript
// packages/driver/src/types.ts
export interface QueryOptions {
  // ...existing fields...
  /** Reasoning effort level for thinking models */
  reasoningEffort?: 'low' | 'medium' | 'high';
}
```

- OpenAIドライバー: 既存のローカル型から移行、APIパラメータとして送信
- MLXドライバー: `apply_chat_template` の引数として Python 側に渡す
- vLLMドライバー: 同上
- 他ドライバー: 無視（既存動作に影響なし）

#### 2. QueryResult: `thinkingContent` の追加

thinkingチャネルの内容を返すフィールドを新設する。

```typescript
// packages/driver/src/types.ts
export interface QueryResult {
  content: string;
  /** Thinking/reasoning content from the model (e.g., Harmony analysis channel) */
  thinkingContent?: string;
  // ...existing fields...
}
```

- llm-jp-4 (Harmony): `analysis` チャネル → `thinkingContent`
- 将来的にAnthropicの `thinking` ブロックなどにも対応可能

#### 3. MLXドライバー: Harmonyレスポンスパーサー（TS側）

`packages/driver/src/mlx-ml/process/` に Harmony パーサーを追加する。

**パース処理の概要:**

入力: モデルの生テキストレスポンス（スペシャルトークン含む）
出力: `{ content: string, thinkingContent?: string, toolCalls?: ToolCall[] }`

```
parseHarmonyResponse(rawText: string) → HarmonyParseResult
```

パースロジック:
1. `<|start|>` でメッセージ境界を分割
2. 各メッセージから `<|channel|>` で チャネル種別を判定
3. `<|message|>` と `<|end|>` / `<|call|>` / `<|return|>` の間がコンテンツ
4. チャネル別に振り分け:
   - `analysis` → thinkingContent に結合
   - `final` → content
   - `commentary to=functions.*` → toolCalls として抽出

**ストリーミングとクエリの挙動差:**

- **query（非ストリーミング）**: analysis/finalを分離し、`thinkingContent` と `content` に分けて返す
- **streamQuery（ストリーミング）**: thinkingチャンクもそのままストリームに流す。`result` Promise では分離した結果を返す

**レスポンスパーサーのインターフェース統一:**

Harmony固有のパーサーではなく、モデル非依存の統一インターフェースとする。`selectResponseProcessor` は全モデルで同じ型を返す:

```typescript
interface ResponseParseResult {
  content: string;
  thinkingContent?: string;
  toolCalls?: ToolCall[];
}

type ResponseProcessor = (rawText: string) => ResponseParseResult;

selectResponseProcessor(modelName: string): ResponseProcessor | null
```

- llm-jp-4: Harmonyチャネルパーサーが `ResponseProcessor` を実装
- 将来的に他モデル（thinking分離が必要なもの）も同じインターフェースで追加可能
- `null` を返す場合はレガシー動作（rawTextをそのままcontentに入れる）

#### 4. MLXドライバー Python側: `reasoning_effort` の受け渡し

`handle_chat` で `apply_chat_template` を呼ぶ際に、options経由で受け取った `reasoning_effort` を引数として渡す。

```python
# __main__.py handle_chat()
prompt = tokenizer.apply_chat_template(
    messages,
    tools=tools,
    add_generation_prompt=add_generation_prompt,
    tokenize=tokenize,
    reasoning_effort=options.get('reasoning_effort', 'medium'),  # 追加
)
```

#### 5. デコード時の空白修正

Sentencepieceベースのトークナイザーでは、Harmonyスペシャルトークンの前後で不正な空白が挿入される問題がある（llm-jp-4のカスタムトークナイザー `Llmjp4Tokenizer._decode()` が回避している処理）。

MLXの `mlx-lm` はカスタムトークナイザーを使わないため、2つの対処法がある:

- **案A: Python側で後処理** — token_idsレベルでHarmonyトークン境界を検出し分割デコード
- **案B: TS側で後処理** — テキストレベルでスペシャルトークン前後の不正空白を除去

→ TS側にパーサーを置く方針なので、**案B**が整合的。パーサーがスペシャルトークンを認識する過程で空白を正規化する。

## Harmony Tool Call形式

Harmonyのtool callはgemma-4とは異なる固有形式:

```
<|start|>assistant to=functions.{name}<|channel|>commentary json<|message|>{JSON引数}<|call|>
```

tool結果の返却:
```
<|start|>functions.{name} to=assistant<|channel|>commentary<|message|>{JSON結果}<|end|>
```

既存の `tool-call-parser.ts` の `parseToolCallContent` にHarmony形式を追加するか、Harmonyパーサー内で直接処理するか要検討。Harmonyパーサーがメッセージ構造を認識する時点でtool callの検出もできるため、パーサー内で処理する方が自然。

## 対象モデルの判定

`selectChatProcessor` 等と同様、モデル名ベースで判定:

```typescript
if (modelName.includes('llm-jp-4') || modelName.includes('llm-jp/llm-jp-4')) {
  return processHarmonyResponse;
}
```

将来的にHarmony形式を採用する他モデルが出た場合は、条件を追加する。

## 影響範囲

| パッケージ | ファイル | 変更内容 |
|-----------|---------|---------|
| `@modular-prompt/driver` | `src/types.ts` | `QueryOptions` に `reasoningEffort` 追加、`QueryResult` に `thinkingContent` 追加 |
| `@modular-prompt/driver` | `src/openai/openai-driver.ts` | ローカル型からQueryOptionsの共通型に移行 |
| `@modular-prompt/driver` | `src/mlx-ml/process/model-handlers.ts` | llm-jp-4ハンドラ追加、`selectResponseProcessor` 新設 |
| `@modular-prompt/driver` | `src/mlx-ml/process/harmony-parser.ts` | 新規: Harmonyレスポンスパーサー |
| `@modular-prompt/driver` | `src/mlx-ml/mlx-driver.ts` | レスポンス後処理呼び出し、`reasoning_effort` 送信 |
| `@modular-prompt/driver` | `src/mlx-ml/python/__main__.py` | `reasoning_effort` を `apply_chat_template` に渡す |

## 未決事項

- [ ] vLLMドライバーでの同等対応（vLLMは `trust_remote_code` 対応なので空白問題はないが、`thinkingContent` 分離はTS側で必要。`ResponseProcessor` インターフェースを共有できるはず）
- [ ] ストリーミング時のチャンク境界処理（スペシャルトークンが分断される場合のバッファリング戦略）
- [ ] `thinkingContent` をprocess層（agentic-workflow等）でどう利用するか
