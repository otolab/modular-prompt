# Tool Call / Tool Result 中間フォーマット仕様

## Context

modular-promptの現在のToolCall/ToolResult型定義はOpenAI APIの形式にロックインしており、各ドライバーが場当たり的にAPI固有の変換を行っている。issue #106（GoogleGenAIのtool result変換バグ）の調査を通じて、根本的な設計問題が明らかになった。

各APIの仕様調査（`prompts/memos/llm-tool-use-api-comparison.v1.md`）に基づき、modular-prompt独自の中間フォーマットを定義し、各ドライバーが「中間フォーマット ⇔ API固有形式」の相互変換を責務として持つアーキテクチャに移行する。

## 設計原則

1. **値をそのまま保持する** — 中間フォーマットではシリアライズ/ラップを行わない。情報落ちをゼロにする
2. **中身が何なのかを明示する** — 値の外側にkindタグを持ち、データの種類を示す
3. **IDを必須化する** — すべてのToolCallに一意IDを付与。Geminiの順序依存はアダプター内に閉じ込める
4. **シリアライズ責務はアダプターに** — JSON.stringify/JSON.parse/オブジェクトラップは各ドライバーのアダプター層で行う

## 中間フォーマット定義

### ToolCall（モデル → アプリ）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `string` | 必須 | 一意識別子。OpenAI/Anthropicはサーバー生成、Geminiはアダプターが生成 |
| `name` | `string` | 必須 | 関数名 |
| `arguments` | `Record<string, unknown>` | 必須 | 引数データ。ネイティブオブジェクトとして保持 |
| `metadata` | `Record<string, unknown>` | 任意 | ドライバー固有のコンテキスト。次ターンへのパススルー用（例: Geminiの`thoughtSignature`） |

**現状からの変更点:**
- `type: 'function'` を廃止（OpenAI固有の概念）
- `function` ネストを廃止（`function.name` → `name`、`function.arguments` → `arguments`）
- `arguments` を `string`（JSON文字列）から `Record<string, unknown>`（オブジェクト）に変更
- `metadata`フィールドを追加（ドライバー固有コンテキストの保持用）

### ToolResult（アプリ → モデル）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `toolCallId` | `string` | 必須 | 対応するToolCallのidへの参照 |
| `name` | `string` | 必須 | 関数名（Geminiが要求するため必須化） |
| `kind` | `string` | 必須 | 値の種類を示すタグ |
| `value` | （kindによる） | 必須 | ツール実行結果の値そのもの |

#### kindタグの定義

| kind | valueの型 | 用途 |
|---|---|---|
| `"text"` | `string` | テキスト結果（モデルにそのまま文字列として渡す） |
| `"data"` | `unknown` | 構造化データ（オブジェクト、配列、数値等。アダプターが型に応じて変換） |
| `"error"` | `string` | エラー結果 |
| `"multimodal"` | TODO: `ContentBlock[]`（※） | テキスト＋画像等 |

※ multimodalの`ContentBlock`中間型は別途定義する（各APIで形式が大きく異なるため独立した仕様として策定）

`text`と`data`の分離はセマンティックな区別である。同じ文字列でも`text`は「そのままモデルに見せる」、`data`に文字列を入れると「JSON.stringifyされて引用符が付く」ため、kindタグなしには判別できない。一方、`data`内部のオブジェクト/配列/スカラの違いはアダプターが`typeof`で判定し、API固有のラップ処理を行う

**現状からの変更点:**
- `content: string` を `kind` + `value` に分離
- `name` をOptionalから必須に変更
- エラー状態をkindタグで明示（Anthropicの`is_error`に対応）

### ToolDefinition（ツール定義）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | `string` | 必須 | 関数名（a-z, A-Z, 0-9, _, - で最大64文字） |
| `description` | `string` | 任意 | 関数の説明。モデルがツール選択の判断に使用 |
| `parameters` | `Record<string, unknown>` | 任意 | パラメータのJSON Schemaオブジェクト |
| `strict` | `boolean` | 任意 | 厳格なスキーマ遵守（OpenAI Structured Outputs連携。他ドライバーでは無視） |

**現状からの変更点:**
- `type: 'function'`ラッパーを廃止
- `function`ネストを廃止（`function.name` → `name`等）

### ToolChoice（ツール選択戦略）

```typescript
type ToolChoice =
  | 'auto'      // モデルが自動判断（デフォルト）
  | 'none'      // ツール使用禁止
  | 'required'  // 必ず1つ以上のツールを使用
  | { name: string };  // 特定ツールを強制
```

**現状からの変更点:**
- `{ type: 'function'; function: { name: string } }` → `{ name: string }` にフラット化

## 各ドライバーのアダプター変換

### 受信変換（APIレスポンス → 中間フォーマット）

#### ToolCall受信

| ドライバー | 変換内容 |
|---|---|
| OpenAI | `JSON.parse(function.arguments)` → `arguments`、`id`はそのまま |
| Anthropic | `input` → `arguments`そのまま、`id`はそのまま |
| Gemini | `args` → `arguments`そのまま、`id`はアダプターが生成。`thoughtSignature`があれば`metadata`に保持 |

#### ToolCall → QueryResult

各ドライバーの`extractToolCalls`（または同等の処理）で、APIレスポンスから中間フォーマットの`ToolCall`に変換する。

### 送信変換（中間フォーマット → APIリクエスト）

#### ToolDefinition送信

| ドライバー | 変換内容 |
|---|---|
| OpenAI | `{ type: 'function', function: { name, description, parameters, strict } }` にラップ |
| Anthropic | `{ name, description, input_schema: { type: 'object', ...parameters } }` に変換 |
| Gemini | `{ functionDeclarations: [{ name, description, parameters }] }` 配列でラップ |

#### ToolChoice送信

| ドライバー | auto | none | required | { name } |
|---|---|---|---|---|
| OpenAI | `'auto'` | `'none'` | `'required'` | `{ type: 'function', function: { name } }` |
| Anthropic | `{ type: 'auto' }` | `{ type: 'none' }` | `{ type: 'any' }` | `{ type: 'tool', name }` |
| Gemini | `AUTO` | `NONE` | `ANY` | `mode: ANY` + `allowedFunctionNames: [name]` |

#### ToolCall送信（会話履歴として再送する場合）

| ドライバー | 変換内容 |
|---|---|
| OpenAI | `arguments` → `JSON.stringify()` → `function.arguments` |
| Anthropic | `arguments` → `input`そのまま |
| Gemini | `arguments` → `args`そのまま |

#### ToolResult送信

| ドライバー | text | data | error | multimodal |
|---|---|---|---|---|
| OpenAI | `content: value` | `content: JSON.stringify(value)` | `content: JSON.stringify({ error: value })` | `content: ContentPart[]` |
| Anthropic | `content: value` | `content: JSON.stringify(value)` | `content: value, is_error: true` | `content: Block[]` |
| Gemini | `response: { output: value }` | 下記参照 | `response: { error: value }` | `parts: FunctionResponsePart[]` |

**Geminiアダプターの`data`変換ロジック:** Geminiの`response`は`Record<string, unknown>`のみ受付のため、アダプターがvalueの型に応じて変換する
- プレーンオブジェクト → `response: value`（そのまま）
- それ以外（配列、数値、boolean、null等） → `response: { output: value }`（ラップ）

**Anthropic固有の順序制約:** Anthropicでは`user`メッセージの`content`配列内で`tool_result`ブロックを常に先頭に配置しなければならない。プレーンテキストを`tool_result`より前に配置するとAPIが400エラーを返す。この制約はAnthropicアダプター内で保証する

## 影響範囲

### 変更が必要なファイル

**coreパッケージ:**
- `packages/core/src/types.ts` — `ToolCall`型の再定義、`ToolResultMessageElement`の変更、`ToolDefinition`/`ToolChoice`型の再定義

**driverパッケージ:**
- `packages/driver/src/types.ts` — `ChatMessage`関連型の更新、`QueryResult.toolCalls`の型更新
- `packages/driver/src/openai/openai-driver.ts` — 変換ロジックの書き直し
- `packages/driver/src/anthropic/anthropic-driver.ts` — 変換ロジックの書き直し
- `packages/driver/src/google-genai/google-genai-driver.ts` — 変換ロジックの書き直し
- `packages/driver/src/vertexai/vertexai-driver.ts` — 変換ロジックの書き直し
- `packages/driver/src/ollama/ollama-driver.ts` — OpenAIDriver継承のため自動的に対応

**テスト:**
- 各ドライバーのテストファイル

## 検証方法

- 各ドライバーの既存テストがパスすること
- ToolCall/ToolResultの変換に関する新規テストの追加
- `npm run typecheck` でコンパイルエラーがないこと
