# @modular-prompt/extract API 仕様

> **対象バージョン**: `0.1.0`（レビュー用ドラフト）  
> **目的**: 実装済みの公開 API のみを記載する。

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

### `defaultExtractBaseModule`

パッケージ同梱のデフォルト base。ざっくり次を含む（詳細は `src/modules/default-base-module.ts`）:

- **objective**: 資料から指示の観点の情報を抽出
- **instructions**: materials / messages / inputs を読み取り正確に抽出、存在しない情報を含めない
- **methodology**: Prepared Materials / Messages / Input Data 各セクションの読み方テンプレート
- **guidelines / preparationNote**: 引用・構造化・出力形式の基本ルール

`baseModule` で丸ごと置き換え可能。`domainModule` で用語・追加指示のみ差し込む使い方を想定。

---

### エントリポイント

```typescript
import {
  createExtractSession,
  createMlxExtractRuntime,
} from '@modular-prompt/extract';
import type {
  ExtractCorpus,
  ExtractRequest,
  ExtractResult,
  ExtractSession,
  ExtractSessionOptions,
  MlxExtractRuntime,
  MlxExtractRuntimeOptions,
} from '@modular-prompt/extract';
```

### 公開シンボル

| シンボル | 種別 | 説明 |
|---------|------|------|
| `createExtractSession` | 関数 | 抽出セッションを生成 |
| `createMlxExtractRuntime` | 関数 | MLX 用 driver + cacheController バンドルを生成 |
| `resolveSessionModules` | 関数 | base (+ domain) モジュールを解決 |
| `defaultExtractBaseModule` | 定数 | デフォルト base `PromptModule` |
| `ExtractSessionOptions` | 型 | セッション生成オプション |
| `ExtractCorpus` | 型 | 固定 corpus 定義 |
| `ExtractRequest` | 型 | 1 回分の抽出リクエスト |
| `ExtractResult` | 型 | 1 回分の抽出結果 |
| `ExtractSession` | 型 | セッションインターフェース |
| `MlxExtractRuntime` | 型 | MLX runtime バンドル |
| `MlxExtractRuntimeOptions` | 型 | MLX runtime 生成オプション |

**非公開**（内部実装）: `build-modules.ts`, `cache-lifecycle.ts`, `test-helpers.ts`

---

## `createMlxExtractRuntime(options)`

MLX 環境向けの便利ファクトリ。**セッションとは独立**しており、複数セッションで同一 runtime を共有できる。

```typescript
function createMlxExtractRuntime(
  options: MlxExtractRuntimeOptions
): Promise<MlxExtractRuntime>
```

### `MlxExtractRuntimeOptions`

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `model` | `string` | ✅ | MLX モデル識別子 |
| `cacheDir` | `string` | — | 固定キャッシュディレクトリ。省略時は managed temp dir |

### `MlxExtractRuntime`

| プロパティ / メソッド | 型 | 説明 |
|---------------------|-----|------|
| `driver` | `AIDriver` | `MlxDriver` インスタンス |
| `cacheController` | `PromptCacheController` | driver と共有する `MlxCacheController` |
| `model` | `string` | `options.model` と同一 |
| `close()` | `() => Promise<void>` | `driver.close()` + `cacheController.close()` |

### 使用例

```typescript
const runtime = await createMlxExtractRuntime({
  model: 'prism-ml/Ternary-Bonsai-1.7B-mlx-2bit',
});

const session = createExtractSession({
  driver: runtime.driver,
  cacheController: runtime.cacheController,
  model: runtime.model,
  baseModule,
  corpus,
});

try {
  await session.extract({ cue: '...' });
  await session.close();
} finally {
  await runtime.close();
}
```

---

## `createExtractSession(options)`

```typescript
function createExtractSession<TContext = unknown>(
  options: ExtractSessionOptions<TContext>
): ExtractSession
```

### `ExtractSessionOptions<TContext>`

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `driver` | `AIDriver` | ✅ | 推論実行ドライバー（cacheController と共有すること） |
| `cacheController` | `PromptCacheController` | ✅ | KV キャッシュコントローラ |
| `model` | `string` | ✅ | `cacheController.prepare()` に渡すモデル識別子（driver と一致） |
| `baseModule` | `PromptModule<TContext>` | — | 抽出タスクの基盤プロンプト。省略時は `defaultExtractBaseModule` |
| `domainModule` | `PromptModule<TContext>` | — | ドメイン調整（用語・追加指示）。`baseModule` の上に merge |
| `corpus` | `ExtractCorpus` | ✅ | セッション固定の抽出対象 |
| `schema` | `object` | — | JSON Schema（`baseModule` に merge） |

`cacheController` / `model` はオプションではない。キャッシュ非対応モードは提供しない。

#### `ExtractCorpus`

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `materials` | `SectionContent` | 文書 corpus |
| `messages` | `SectionContent` | 対話ログ |

- セッション生成後の corpus 変更 API はない

---

## `ExtractSession`

### `extract(request): Promise<ExtractResult>`

#### `ExtractRequest`

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `cue` | `string \| SectionContent` | ✅ | 抽出切り口（output / cue セクション） |
| `inputs` | `Record<string, unknown> \| SectionContent` | — | 補強情報（inputs セクション） |
| `options` | `QueryOptions` | — | ドライバーへのクエリオプション |

##### 正規化

| フィールド | `string` | `Record` | `SectionContent` |
|-----------|----------|----------|------------------|
| `cue` | `[string]` | — | そのまま |
| `inputs` | — | `JSON.stringify` 1 行 | そのまま |

#### プロンプト組み立て

```
merge(sessionBaseModule, corpusModule, requestModule) → compile → driver.query()
```

#### `ExtractResult`

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `text` | `string` | `QueryResult.content` |
| `structured` | `unknown` | `QueryResult.structuredOutput` |
| `usage` | `QueryResult['usage']` | トークン使用量 |
| `index` | `number` | セッション内 0 始まり連番 |

#### エラー

| 条件 | エラー |
|------|--------|
| `close()` 後の `extract()` | `Error: ExtractSession is closed` |
| `model` が空文字 | `Error: ExtractSessionOptions.model is required` |

---

### `getHistory(): ReadonlyArray<ExtractResult>`

セッション内の全抽出結果のコピーを返す。

---

### `close(): Promise<void>`

セッションを終了する。**セッションが保持する cache handle の `release()` のみ**行う。

| 処理 | 行うか |
|------|--------|
| `cacheController.release(heldHandle)` | ✅ |
| `cacheController.close()` | ❌ |
| `driver.close()` | ❌ |

- 冪等（複数回呼び出し可）
- `close()` 後の `extract()` は拒否

---

## キャッシュ連携

毎回の `extract()` で:

1. `buildCacheModule()` — base + corpus + request（`cue` 含む）を merge
2. `cacheController.prepare()` — `partitionPrompt` で cacheable 部分のみ prefill（`cue` は `cacheHint: 'contextual'` かつ output セクションのため対象外）
3. `supersedes` 返却時 — 旧 handle を `release()`
4. `driver.query()` — `{ cache: false, cacheHandle }` で二重 prepare を回避

| セクション | キャッシュ |
|-----------|-----------|
| baseModule（instructions） | ✅ |
| corpus（materials, messages） | ✅ |
| inputs | ✅（incremental） |
| cue | ❌ | `cacheHint: 'contextual'`。output セクションのため prepare 対象外 |

---

## 実装状況

| 項目 | 状態 |
|------|------|
| Phase 1 コア API | ✅ |
| Phase 2 キャッシュ統合 | ✅ |
| `createMlxExtractRuntime` | ✅ |
| cacheController / model 必須化 | ✅ |
| session.close() は handle release のみ | ✅ |
| Phase 3 便利機能 | ⬜ |
| README / サンプル | ⬜（本ドキュメントが API 仕様の暫定版） |

**テスト**: `pnpm --filter @modular-prompt/extract test:run`

---

## 設計上の注意

1. **driver / cacheController の close は呼び出し側の責務**  
   通常は `createMlxExtractRuntime().close()` でまとめて片付ける。

2. **同一 driver を複数セッションで共有可能**  
   各セッションの `close()` は handle release のみなので、driver は生存したまま。

3. **corpus / baseModule はセッション固定**  
   変更時は新セッションを作る。

4. **inputs 累積は自動ではない**  
   段階的深掘りは呼び出し側が `inputs` に明示的に渡す。

5. **デフォルト cacheController 生成は extract 内にない**  
   `createExtractSession` は受け取った依存を使うだけ。生成は `createMlxExtractRuntime` または呼び出し側。
