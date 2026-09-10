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
  resolveModelSpec,
  createDriver,
  buildPreviousExtractionsInputs,
  inputChunk,
  inputChunksFromJson,
  mergeExtractBaseModule,
  defaultExtractBaseModule,
  resolveDefaultContainerDir,
  resolveStoreDir,
  validateStorename,
} from '@modular-prompt/extract';
```

named store のパス解決と入力検証をライブラリから利用する場合:

```typescript
import {
  resolveDefaultContainerDir,
  resolveStoreDir,
  validateStorename,
} from '@modular-prompt/extract';

validateStorename('meeting');
const storeDir = resolveStoreDir(resolveDefaultContainerDir(), 'meeting');
```

### 公開シンボル

| シンボル | 種別 | 説明 |
|---------|------|------|
| `createExtractSession` | 関数 | 抽出セッションを生成 |
| `createMlxExtractRuntime` | 関数 | MLX 用 driver + cacheController バンドル |
| `resolveModelSpec` | 関数 | models.yaml の alias または生 model ID を extract 用 ModelSpec に解決 |
| `createDriver` | 関数 | 解決済み ModelSpec から AIService 経由で MLX driver を生成 |
| `resolveSessionModules` | 関数 | base (+ domain) モジュールを解決 |
| `resolveDefaultContainerDir` | 関数 | `MODULAR_PROMPT_HOME` に基づくデフォルト cache container を解決 |
| `resolveStoreDir` | 関数 | cache コンテナと storename から store ディレクトリを解決 |
| `validateStorename` | 関数 | storename の形式と予約語を検証 |
| `compileExtractPrompt` | 関数 | context 付き compile（高度な用途） |
| `buildExtractContext` | 関数 | corpus + request から `ExtractContext` を構築 |
| `defaultExtractBaseModule` | 定数 | デフォルト base `PromptModule` |
| `mergeExtractBaseModule` | 関数 | デフォルト base に overlay を merge |
| `buildPreviousExtractionsInputs` | 関数 | 過去抽出結果を `inputs` に変換 |
| `formatPreviousExtractions` | 関数 | 過去抽出結果をテキストブロック列に整形 |
| `inputChunk` / `inputChunksFromJson` | 関数 | chunk 入力ヘルパ |
| `normalizeMaterials` 等 | 関数 | 正規化ヘルパ（テスト・高度な用途） |

### 内部 API（named store 拡張の共有実装）

`src/extract-store.ts` は package root からは export しない内部 API ですが、CLI と将来の store 管理入口が共有する disk 上の store 操作を担当します。`add-command.ts` はファイル読み込み、引数由来のエラー、`--dry-run` の出力だけを担当し、prefill と manifest の更新はこの層を呼び出します。

| API | 入力 / 出力 | 責務と保証 |
|-----|-------------|------------|
| `mergeMaterials(existing, incoming)` | `MaterialInput[]` → merged `MaterialInput[]` | `id`（省略時は `title`）で順序を保ってマージ。同一 id・同一内容はスキップし、内容差分はエラー |
| `prepareExtractCache({ cacheDir, model, materials })` | `Promise<string>`（解決済み model） | prepare cue で corpus を KV prefill し、session/runtime を close。manifest は変更しない |
| `appendToExtractStore({ storeDir, storename, incomingMaterials, existingManifest?, now? })` | `Promise<{ manifest, model, addedMaterials }>` | 既存 store を staging に複製して incremental prefill と manifest 更新を行い、成功時に rename 交換。prefill / manifest / runtime の失敗時は元の corpus・manifest・KV を保持 |

`appendToExtractStore` は `manifest.model` を使い、成功時だけ `updatedAt` と materials を反映します。`readExtractStoreManifest` は store の存在と manifest を検証し、存在しない store には `create` を案内するエラーを返します。ライブラリ層のマージ、prefill、失敗時保全は `src/extract-store.test.ts` で CLI から独立して検証しています。

---

create/add が内部で使う `prepareExtractCache` は `cachePreparation: 'required'` で session を実行するため、cache controller が空 handle を返した場合は driver query、manifest 書き込み、store の rename 交換に進みません。通常の `createExtractSession` は省略時の `best-effort` 契約を維持します。

## `createMlxExtractRuntime(options)`

```typescript
function createMlxExtractRuntime(
  options: MlxExtractRuntimeOptions
): Promise<MlxExtractRuntime>
```

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `model` | `string` | — | MLX モデルの alias または生の HF model ID。省略時は bundled + user models.yaml から解決。`MLX_MODEL` も後方互換で同梱 default として使用 |
| `cacheDir` | `string` | — | 固定キャッシュディレクトリ。省略時は managed temp dir |

`MlxExtractRuntime.close()` は `driver.close()` + `cacheController.close()` を行う。

`createMlxExtractRuntime` は AIService 経由でモデルを解決・生成し、**mlx-lm バックエンド（`backend: 'lm'`）に固定**する。`auto` で VLM が選ばれるとプロンプトキャッシュが無効になるため。モデル指定を省略した場合は `models.default`、なければ `models` の先頭エントリを使用する。同梱設定より `~/.modular-prompt/models.yaml` が優先される。`MLX_MODEL` を設定した場合は同梱 default のモデル ID が置き換わり、user yaml の `models.default` がさらに優先される。

`createDriver(model, { cacheController })` は runtime 内部で使用する低レベル helper で、戻り値は `{ driver, spec }`。`spec.model` は alias 解決後の生 model ID である。

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
| `cachePreparation` | `'best-effort' \| 'required'` | — | 通常は `best-effort`（省略時）。`required` は空 handle をエラーにして driver query を実行しない |

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

CLI の `clean <storename>` で store 単位、`clean --all` で cache container 全体を削除できる。対象が存在しない場合は no-op になる。

---

## CLI（`modular-prompt-extract`）

`modular-prompt-extract` は cache container 内に named store を作成・利用する。`-d` の値は container パスで、create/add/extract/list/clean 共通で使用する。省略時は `~/.modular-prompt/extract-cache`（`MODULAR_PROMPT_HOME` を設定した場合は `${MODULAR_PROMPT_HOME}/extract-cache`）。

```bash
modular-prompt-extract create <storename> [-m <model>] [--dry-run] <files...>
modular-prompt-extract add <storename> [--dry-run] <files...>
modular-prompt-extract extract <storename> [--max-tokens <n>] [--dry-run] <query...>
modular-prompt-extract list
modular-prompt-extract clean <storename>
modular-prompt-extract clean --all
```

container を指定する場合は、各コマンドに `-d <cache-dir>` を追加する。

```bash
modular-prompt-extract create meeting -d ~/.modular-prompt/extract-cache -m default docs/meeting.txt
modular-prompt-extract add meeting -d ~/.modular-prompt/extract-cache docs/day2.txt
modular-prompt-extract extract meeting -d ~/.modular-prompt/extract-cache '参加者を列挙'
modular-prompt-extract list -d ~/.modular-prompt/extract-cache
modular-prompt-extract clean meeting -d ~/.modular-prompt/extract-cache
modular-prompt-extract clean --all -d ~/.modular-prompt/extract-cache
```

`<storename>` は create/add/extract/clean の positional 第1引数として必須（`clean --all` を除く）で、`[a-zA-Z0-9][a-zA-Z0-9_-]*` に一致する必要がある。`create`、`add`、`extract`、`list`、`clean` は予約語である。

`add <storename> [--dry-run] <files...>` は既存 store の manifest にファイルを追記し、manifest の model で prepare cue を実行する。既存 cache を staging store に複製してから incremental prefill と manifest 更新を行い、成功時にだけ store を入れ替える。prefill または manifest 更新が失敗した場合は元の store を保持する。同じ絶対パス `id` の同一内容はスキップし、内容が異なる場合は `clean` + `create` を案内してエラーにする。

`add --dry-run` はマージ後の compile 済みプロンプトを表示し、MLX の起動・KV cache の書き込み・manifest の更新を行わない。`add` では `-m` と `--max-tokens` は指定できない。

これは破壊的変更であり、旧 CLI 引数形式と旧レイアウト（container 直下の `manifest.json` と cache files）はサポートしない。旧デフォルト `./.extract-cache` の自動検出・自動移行も行わない。既存データを利用する場合は、[README の旧 CLI / キャッシュレイアウトからの手動移行手順](./README.md#旧-cli--キャッシュレイアウトからの移行)に従って、新しいデフォルトまたは `-d` で指定した store container へ移動する。

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
