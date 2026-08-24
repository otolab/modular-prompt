# @modular-prompt/extract API 仕様

> **対象バージョン**: `0.1.0`  
> **利用者向けガイド**: [README.md](./README.md)（サンプル・キャッシュ制約含む）

## 概要

`@modular-prompt/extract` は、同一 corpus（文書・対話ログ）に対して **複数の切り口（cue）で繰り返し情報抽出** するためのセッション API を提供する。

- 基盤プロンプト（`baseModule`）と corpus（`materials` / `messages`）はセッション存続中固定
- 各 `extract()` 呼び出しで `cue`（出力切り口）と `inputs`（補強情報）を差し替え
- **KV キャッシュ連携は必須** — `driver` / `cacheController` / `model` は呼び出し側が用意する
- **リソースのライフサイクルは呼び出し側が管理** — `ExtractSession.close()` はセッション内 cache handle の `release()` のみ行う

## 責務の分離

| コンポーネント | 生成 | 終了 |
|--------------|------|------|
| `driver` + `cacheController` | 呼び出し側（または `createMlxExtractRuntime`） | 呼び出し側（`runtime.close()` 等） |
| `ExtractSession` | `createExtractSession()` | `session.close()` — handle `release()` のみ |

`ExtractSession` は driver / cacheController を **借りる** だけで、所有しない。

---

## モジュール構成

```
base (+ domain) + corpus (materials / messages) + request (inputs) ← cue
```

| レイヤ | 指定方法 | 役割 |
|--------|---------|------|
| **base** | 省略可 → `defaultExtractBaseModule` | 抽出タスクの基本方針 |
| **domain** | `domainModule`（任意） | 用語定義・追加指示などのドメイン調整 |
| **data** | `corpus` + `request.inputs` | 抽出対象・補強情報 |
| **cue** | `request.cue` | 今回の抽出切り口 |

### 入力型（最小入力 → Element 正規化）

API 境界では Element を直接渡さない。`buildExtractContext` が正規化する。

| スロット | 入力型 | 正規化結果 |
|---------|--------|-----------|
| `corpus.materials` | `MaterialInput \| MaterialInput[]` | `MaterialElement`（`cacheHint: immutable`） |
| `corpus.messages` | `MessageInput \| MessageInput[]` | `MessageElement`（role 別 cacheHint） |
| `request.inputs` | `string \| ChunkInput \| ...[]` | `ChunkElement`（`cacheHint: contextual`） |
| `request.cue` | `string \| SectionContent` | `TextElement`（`cacheHint: contextual`） |

#### `MaterialInput`

```typescript
{ title: string; content: string | Attachment[]; id?: string; usage?: number }
```

`id` 省略時は `title` を使用。

#### `MessageInput`

標準: `{ role: 'system' | 'assistant' | 'user'; content: ... }`  
ツール結果: `{ role: 'tool'; toolCallId; name; kind; value }`

#### `ChunkInput` / `ChunkInputValue`

`string` は `content` の省略記法。`partOf` 省略時は `'inputs'`。

---

## エントリポイント

```typescript
import {
  createExtractSession,
  createMlxExtractRuntime,
  buildPreviousExtractionsInputs,
  inputChunk,
  inputChunksFromJson,
  mergeExtractBaseModule,
  defaultExtractBaseModule,
} from '@modular-prompt/extract';
```

### 公開シンボル

| シンボル | 種別 | 説明 |
|---------|------|------|
| `createExtractSession` | 関数 | 抽出セッションを生成 |
| `createMlxExtractRuntime` | 関数 | MLX 用 driver + cacheController バンドル |
| `resolveSessionModules` | 関数 | base (+ domain) モジュールを解決 |
| `compileExtractPrompt` | 関数 | context 付き compile（高度な用途） |
| `buildExtractContext` | 関数 | corpus + request から `ExtractContext` を構築 |
| `defaultExtractBaseModule` | 定数 | デフォルト base `PromptModule` |
| `mergeExtractBaseModule` | 関数 | デフォルト base に overlay を merge |
| `buildPreviousExtractionsInputs` | 関数 | 過去抽出結果を `inputs` に変換 |
| `formatPreviousExtractions` | 関数 | 過去抽出結果をテキストブロック列に整形 |
| `inputChunk` / `inputChunksFromJson` | 関数 | chunk 入力ヘルパ |
| `normalizeMaterials` 等 | 関数 | 正規化ヘルパ（テスト・高度な用途） |

---

## `createMlxExtractRuntime(options)`

```typescript
function createMlxExtractRuntime(
  options: MlxExtractRuntimeOptions
): Promise<MlxExtractRuntime>
```

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `model` | `string` | ✅ | MLX モデル識別子 |
| `cacheDir` | `string` | — | 固定キャッシュディレクトリ。省略時は managed temp dir |

`MlxExtractRuntime.close()` は `driver.close()` + `cacheController.close()` を行う。

`createMlxExtractRuntime` は **mlx-lm バックエンド（`backend: 'lm'`）に固定**する。`auto` で VLM が選ばれるとプロンプトキャッシュが無効になるため。

---

## `createExtractSession(options)`

```typescript
function createExtractSession<TContext = ExtractContext>(
  options: ExtractSessionOptions<TContext>
): ExtractSession
```

### `ExtractSessionOptions<TContext>`

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `driver` | `AIDriver` | ✅ | 推論実行ドライバー |
| `cacheController` | `PromptCacheController` | ✅ | KV キャッシュコントローラ |
| `model` | `string` | ✅ | `prepare()` 用モデル識別子 |
| `baseModule` | `PromptModule<TContext>` | — | 省略時 `defaultExtractBaseModule` |
| `domainModule` | `PromptModule<TContext>` | — | base の上に merge |
| `corpus` | `ExtractCorpus` | ✅ | セッション固定 corpus |
| `schema` | `object` | — | JSON Schema（structured output） |

#### `ExtractCorpus`

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `materials` | `MaterialsInput` | 文書 corpus |
| `messages` | `MessagesInput` | 対話ログ |

### `ExtractSession.extract(request)`

#### `ExtractRequest`

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `cue` | `string \| SectionContent` | ✅ | 抽出切り口 |
| `inputs` | `InputsInput` | — | 補強情報 |
| `options` | `QueryOptions` | — | ドライバークエリオプション |

#### `ExtractResult`

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `text` | `string` | 抽出テキスト |
| `structured` | `unknown` | schema 指定時の構造化出力 |
| `usage` | `QueryResult['usage']` | トークン使用量（`cacheReadTokens` 含む） |
| `index` | `number` | セッション内連番（0 始まり） |

### `getHistory()` / `close()`

- `getHistory()` — セッション内全結果のコピー
- `close(options?)` — セッション終了（冪等）。`close()` 後の `extract()` は拒否
  - `releaseCache`（デフォルト `true`）— `false` のとき handle を release しない。固定 cacheDir をプロセス間で再利用する場合に使う
  - `releaseCache: true` のとき `cacheController.release()` が呼ばれ、続く `runtime.close()` で KV ファイルが削除される（固定 cacheDir モード）

手動クリーン: cache ディレクトリを `rm -rf` で削除（CLI の想定運用）。

---

## キャッシュ連携

毎回の `extract()` で:

1. `compileExtractPrompt` — `ExtractContext` を解決して compile
2. `cacheController.prepare()` — cacheable 部分を prefill
3. `supersedes` 返却時 — 旧 handle を `release()`
4. `driver.query()` — `{ cache: false, cacheHandle }` で二重 prepare を回避

| セクション | キャッシュ |
|-----------|-----------|
| baseModule（instructions） | ✅ |
| corpus（materials, messages） | ✅ |
| inputs | ✅（incremental） |
| cue | ❌ |

### 制約（再掲）

- **corpus / baseModule 変更** → 新セッション
- **inputs 累積** → 自動ではない。`buildPreviousExtractionsInputs` 等で明示的に渡す
- **driver / cacheController の close** → 呼び出し側（`runtime.close()`）

---

## 実装状況

| 項目 | 状態 |
|------|------|
| Phase 1 コア API | ✅ |
| Phase 2 キャッシュ統合 | ✅ |
| Phase 3 便利機能 | ✅ |
| Phase 4 ドキュメント・サンプル | ✅ |

**テスト**: `pnpm --filter @modular-prompt/extract test:run`
