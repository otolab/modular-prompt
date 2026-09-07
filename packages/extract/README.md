# @modular-prompt/extract

同一 corpus（文書・対話ログ）に対して、**複数の切り口（cue）で繰り返し情報抽出**するセッション API。

KV キャッシュを活用し、corpus を一度 prefill したあと `cue` と `inputs` だけを差し替えて抽出を繰り返す。RAG に近いが、検索インデックスではなくプロンプトキャッシュを伸ばしながら文書全体をコンテキストに保持するパターン向け。

## インストール

```bash
npm install @modular-prompt/extract @modular-prompt/driver
```

ワークスペース内では `@modular-prompt/core` / `@modular-prompt/driver` が依存として解決される。

## 概要

```
base (+ domain) + corpus (materials / messages) + request (inputs) ← cue
```

| レイヤ | 指定タイミング | 役割 |
|--------|--------------|------|
| **base** | セッション生成 | 抽出タスクの基本方針（省略時は `defaultExtractBaseModule`） |
| **domain** | セッション生成 | 用語定義・追加指示（`domainModule` で overlay） |
| **corpus** | セッション生成 | 固定の抽出対象（`materials` / `messages`） |
| **inputs** | 各 `extract()` | 補強情報（前回結果・フィルタ条件など） |
| **cue** | 各 `extract()` | 今回の出力切り口 |

### 入力の考え方

呼び出し側は Element を直接組み立てない。**スロットごとの最小入力**を渡すと、フレームワークが `MaterialElement` / `MessageElement` / `ChunkElement` に正規化する。

| スロット | 最小入力 | 例 |
|---------|---------|-----|
| `materials` | `{ title, content, id? }` | `{ title: '議事録', content: '...' }` |
| `messages` | `{ role, content, ... }` | `{ role: 'user', content: '要約して' }` |
| `inputs` | `string` または `{ content, ... }` | `'補助テキスト'` / `inputChunk(...)` |
| `cue` | `string` | `'登場人物を列挙'` |

`type`・`cacheHint`・`partOf` は正規化層が付与する。呼び出し側で指定する必要はない。

## クイックスタート（MLX）

### CLI

ビルド後、ワークスペース内では次のように実行できる。

```bash
pnpm --filter @modular-prompt/extract build

# 1. 入力ファイルから meeting store を作成（デフォルト: ~/.modular-prompt/extract-cache）
node packages/extract/bin/modular-extract.js create meeting -m 'your-mlx-model' docs/*.txt

# 2. 既存 store にファイルを追加（incremental prefill）
node packages/extract/bin/modular-extract.js add meeting docs/day2.txt

# 3. 抽出クエリ（cue）を実行 — 結果は stdout
node packages/extract/bin/modular-extract.js extract meeting '登場人物を列挙'

# 4. コンテナ内の store を一覧表示
node packages/extract/bin/modular-extract.js list

# 5. store 単位のキャッシュ削除
node packages/extract/bin/modular-extract.js clean meeting
```

| コマンド | 説明 |
|---------|------|
| `create <storename> [-d <container>] [-m <alias-or-model-id>] [files...]` | corpus を読み込み KV cache を準備。`manifest.json` を `<container>/<storename>/` に保存 |
| `add <storename> [-d <container>] [files...]` | 既存 store の corpus にファイルを追記し、KV cache を incremental prefill で拡張 |
| `extract <storename> [-d <container>] [query...]` | 指定 store のキャッシュ済み corpus に対して抽出。query が cue になる |
| `list [-d <container>]` | コンテナ内の全 store と manifest/KV のサマリを表示 |
| `clean <storename> [-d <container>]` | 指定 store の manifest + KV キャッシュを再帰削除。存在しない store は no-op |
| `clean --all [-d <container>]` | コンテナ全体を再帰削除。存在しないコンテナは no-op |
| `extract <storename> --max-tokens <n>` | 最大生成トークン数（デフォルト: 8000） |
| `--dry-run` | MLX を起動せず、compile 済みプロンプト全文を stdout に出力 |

`list` は各 store の model、materials 数・タイトル、作成日時、KV cache の有無を表示します。

```text
Store: meeting
  Model: mlx-community/SomeModel-4bit
  Materials: 2 (notes.txt, meeting.md)
  Created: 2026-09-07T03:00:00.000Z
  Updated: 2026-09-07T04:00:00.000Z
  KV cache: present
```

```bash
# プロンプト確認（create）
modular-extract create meeting --dry-run docs/notes.txt

# プロンプト確認（extract — store の manifest が必要）
modular-extract extract meeting --dry-run '登場人物を列挙'
```

`-d` 省略時のデフォルトは `~/.modular-prompt/extract-cache` で、create/add/extract/list/clean 共通の **store コンテナ**を指定します。`MODULAR_PROMPT_HOME` を設定している場合は、その値の下の `extract-cache` が使用されます。`-m` には models.yaml の alias（例: `default`）または生の HF model ID を指定できます。create/add/extract/clean では `<storename>` が必須（`clean --all` を除く）で、コンテナ配下の `<storename>/` が利用されます。
`-m` 省略時は、同梱 models 設定と `~/.modular-prompt/models.yaml`（`MODULAR_PROMPT_HOME` で変更可）をマージし、`models.default`、なければ先頭のモデルを使用します。user yaml の `default` は同梱 default を上書きします。
`MLX_MODEL` 環境変数も後方互換のためサポートしており、設定時は同梱 default のモデル ID として扱います。user yaml の `models.default` は `MLX_MODEL` より優先されます。

たとえば `~/.modular-prompt/models.yaml` に次を置くと、`create meeting -m default` と `create meeting` の両方でこのモデルが選ばれます。

```yaml
models:
  default:
    provider: mlx
    model: mlx-community/YourModel-4bit
```

モデルが設定されていない構成では、`-m <model-id-or-alias>` を指定するか、user yaml に `models.default` を定義してください。

**MLX バックエンドは mlx-lm（`backend: 'lm'`）に固定**している。`auto` で VLM が選ばれるとプロンプトキャッシュが無効になるため。

### ライブラリ API

```typescript
import {
  createExtractSession,
  createMlxExtractRuntime,
} from '@modular-prompt/extract';

const runtime = await createMlxExtractRuntime({
  model: 'prism-ml/Ternary-Bonsai-1.7B-mlx-2bit',
});

try {
  const session = createExtractSession({
    driver: runtime.driver,
    cacheController: runtime.cacheController,
    model: runtime.model,
    corpus: {
      materials: [{
        title: 'Meeting Notes',
        content: 'Alice met Bob in Paris to discuss the modular-prompt project.',
      }],
    },
  });

  const people = await session.extract({ cue: 'List people mentioned' });
  const places = await session.extract({ cue: 'List cities mentioned' });

  console.log(people.text);
  console.log(places.text);
  // 2 回目以降: places.usage?.cacheReadTokens > 0 が期待できる

  await session.close();
} finally {
  await runtime.close();
}
```

## キャッシュの意図と制約

### 削除タイミング

| タイミング | 何が起きるか |
|-----------|-------------|
| `session.close()`（デフォルト） | handle を `release` マーク → 次の `runtime.close()` で **KV ファイル削除** |
| `session.close({ releaseCache: false })` | release しない → **KV ファイルは disk に残る**（CLI はこちら） |
| `runtime.close()`（固定 cacheDir） | `release` 済みエントリの `.safetensors.zip` を削除 |
| `runtime.close()`（一時 cacheDir） | **ディレクトリごと削除** |
| `add <storename> files...` | 既存 store を staging にコピーし、追加 corpus の incremental prefill と manifest 更新が成功した後に入れ替え |
| `clean <storename> [-d <container>]` | 1 store の manifest + KV キャッシュを再帰削除 |
| `clean --all [-d <container>]` | コンテナ内の全 store を再帰削除 |

`create` 直後に store 内へ `manifest.json` だけ残って `.safetensors.zip` が無い場合、以前のバージョンでは `session.close()` が release していたのが原因。CLI は `releaseCache: false` で修正済み。

### 意図

- **corpus（materials / messages）** はセッション内で不変 → 1 回 prefill すれば再利用
- **inputs** は呼び出しごとに増える → incremental prefill でキャッシュを伸ばす
- **cue** は毎回変わる → output セクションのためキャッシュ対象外

### 制約

| 変更内容 | 対応 |
|---------|------|
| `corpus` を変えたい | ライブラリでは **新しいセッション**を作る。CLI store は `add` で incremental prefill する |
| `baseModule` を変えたい | **新しいセッション**を作る |
| 前回の抽出結果を参照したい | 次の `extract()` の `inputs` に明示的に渡す（自動累積しない） |
| driver / cacheController の終了 | 呼び出し側の責務（`runtime.close()` 等） |
| セッション終了 | `session.close()` — デフォルトで handle `release()`。固定 cacheDir を残す場合は `{ releaseCache: false }` |

`cacheController` は **必須**。`createMlxExtractRuntime` の `model` は省略でき、CLI と同じ models.yaml 解決を行います。指定する場合は alias または生の HF model ID を使えます。キャッシュ非対応モードは提供しない。

詳細は [プロンプトキャッシュ設計](../../docs/CACHE_DESIGN.md) および [API 仕様](./API.md) を参照。

## サンプル

`examples/` に実行可能なサンプルを同梱している。

| ファイル | 内容 |
|---------|------|
| [document-extraction.ts](./examples/document-extraction.ts) | 文書（materials）+ 複数 cue |
| [dialogue-extraction.ts](./examples/dialogue-extraction.ts) | 対話ログ（messages）+ 資料 |
| [progressive-deep-dive.ts](./examples/progressive-deep-dive.ts) | inputs 積み上げ + キャッシュ活用 |

### 文書抽出（materials + 複数 cue）

```typescript
import { createExtractSession, createMlxExtractRuntime } from '@modular-prompt/extract';

const runtime = await createMlxExtractRuntime({ model: 'your-mlx-model' });

const session = createExtractSession({
  driver: runtime.driver,
  cacheController: runtime.cacheController,
  model: runtime.model,
  corpus: {
    materials: [
      { title: '契約書 v3', content: '...' },
      { title: '別紙 料金表', content: '...' },
    ],
  },
});

await session.extract({ cue: '契約期間と更新条件を抽出' });
await session.extract({ cue: '料金体系と支払条件を抽出' });
await session.close();
await runtime.close();
```

### 対話ログ抽出（messages + materials）

```typescript
const session = createExtractSession({
  driver: runtime.driver,
  cacheController: runtime.cacheController,
  model: runtime.model,
  corpus: {
    materials: [{ title: '製品仕様', content: '...' }],
    messages: [
      { role: 'user', content: 'この機能の制約を教えて' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: 'では代替案は？' },
    ],
  },
});

await session.extract({ cue: '議論された制約と合意事項を抽出' });
```

### 段階的深掘り（inputs + キャッシュ）

```typescript
import {
  buildPreviousExtractionsInputs,
  inputChunksFromJson,
} from '@modular-prompt/extract';

const overview = await session.extract({ cue: '会議の概要を1段落で' });

const details = await session.extract({
  cue: '概要を踏まえ、決定事項と未決事項を整理',
  inputs: buildPreviousExtractionsInputs([overview]),
});

// JSON 補助情報を渡す場合
await session.extract({
  cue: '担当者と期限を表形式で',
  inputs: inputChunksFromJson({ focus: 'action items' }),
});
```

## ドメイン調整と structured output

```typescript
import { mergeExtractBaseModule } from '@modular-prompt/extract';

const session = createExtractSession({
  driver: runtime.driver,
  cacheController: runtime.cacheController,
  model: runtime.model,
  domainModule: {
    terms: ['「PJ」は modular-prompt プロジェクトを指す。'],
  },
  corpus: { materials: [{ title: 'Notes', content: '...' }] },
  schema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
});

const result = await session.extract({ cue: '人物名を抽出' });
console.log(result.structured); // schema に沿った JSON
```

`baseModule` を丸ごと差し替えることも可能。汎用挙動を保ちつつ追記する場合は `mergeExtractBaseModule()` を使う。

## 公開 API（主要）

| シンボル | 説明 |
|---------|------|
| `createExtractSession` | 抽出セッションを生成 |
| `createMlxExtractRuntime` | MLX 用 driver + cacheController バンドル |
| `resolveModelSpec` | alias または生 model ID から extract 用 ModelSpec を解決 |
| `createDriver` | 解決済み ModelSpec から AIService 経由で MLX driver を生成 |
| `resolveDefaultContainerDir` | `MODULAR_PROMPT_HOME` に基づくデフォルト cache container を解決 |
| `resolveStoreDir` | cache コンテナと storename から store ディレクトリを解決 |
| `validateStorename` | storename の形式と予約語を検証 |
| `defaultExtractBaseModule` | デフォルト base モジュール |
| `mergeExtractBaseModule` | デフォルト base に overlay を merge |
| `buildPreviousExtractionsInputs` | 過去抽出結果を inputs に変換 |
| `inputChunk` / `inputChunksFromJson` | chunk 入力ヘルパ |

型: `ExtractCorpus`, `ExtractRequest`, `ExtractResult`, `ExtractSession`, `MaterialInput`, `MessageInput`, `ChunkInput` など。

完全な API リファレンスは [API.md](./API.md) を参照。

## CLI（`modular-extract`）

`bin/modular-extract.js` 経由で利用できる簡易 CLI。

```bash
pnpm --filter @modular-prompt/extract build

modular-extract create meeting [-d <cache-dir>] [-m <alias-or-model-id>] file1.txt file2.txt
modular-extract add meeting [-d <cache-dir>] file3.txt
modular-extract create contract [-d <cache-dir>] [-m <alias-or-model-id>] contract.pdf
modular-extract extract meeting [-d <cache-dir>] '抽出したい内容の指示'
modular-extract extract contract [-d <cache-dir>] '契約期間を抽出'
modular-extract list [-d <cache-dir>]
modular-extract clean meeting [-d <cache-dir>]
modular-extract clean --all [-d <cache-dir>]
```

`<storename>` は create/add/extract/clean の positional 第1引数で必須です（`clean --all` を除く）。`[a-zA-Z0-9][a-zA-Z0-9_-]*` に一致し、`create`・`add`・`extract`・`list`・`clean` は使用できません。`-d` は store コンテナを指定し、create は `<container>/<storename>/` にキャッシュと `manifest.json` を保存します。既存 store に対する create は失敗するため、`modular-extract clean <storename>`（必要に応じて `-d <container>`）で削除してから再実行します。

`add <storename> files...` は manifest の model を使って既存 store に資料を追加します。新しいファイルは絶対パスを `id` として追記され、同じ `id`・同じ内容の再追加はスキップされます。同じ `id` の内容が変わっている場合は、キャッシュとの不整合を避けるためエラーになります。その場合は `clean` してから `create` し直してください。`add --dry-run` は MLX を起動せず、マージ後のプロンプトを表示します。

`add` は既存 store を直接上書きしません。staging store で prefill と manifest 書き込みを完了してから store ディレクトリを入れ替えるため、prefill または manifest 更新に失敗した場合は既存の corpus と KV cache が保持されます。

`-m` は models.yaml の alias（`default` など）または生の HF model ID を受け付けます。省略時は同梱 models 設定に user の `~/.modular-prompt/models.yaml` を重ねて解決します。`create` は解決後の生 model ID を store 内の `manifest.json` に保存し、`extract` はその ID で再開します。いずれも **mlx-lm バックエンド固定**（キャッシュ互換のため）。

### 旧 CLI / キャッシュレイアウトからの移行

デフォルト cache container の変更は破壊的変更です。旧 `./.extract-cache` は自動検出・自動移行しません。#353 以降の named store レイアウトを使用していた場合は、必要な store を新しいデフォルト配下へ手動で移動してください。`MODULAR_PROMPT_HOME` を設定している場合は、移行先の `~/.modular-prompt` を設定値に置き換えます。

```bash
# 例: named store の meeting を旧 .extract-cache から移行
mkdir -p ~/.modular-prompt/extract-cache
mv ./.extract-cache/meeting ~/.modular-prompt/extract-cache/
```

移行後は新形式で `modular-extract extract meeting '...'` を実行します。複数の store がある場合は、それぞれ移動してください。

#353 より前の flat レイアウト（コンテナ直下の `manifest.json` と cache files）を使用していた場合は、storename を決めて次のように移行します。

```bash
mkdir -p ~/.modular-prompt/extract-cache/meeting
mv ./.extract-cache/manifest.json \
  ./.extract-cache/cache-index.json \
  ./.extract-cache/*.safetensors* \
  ~/.modular-prompt/extract-cache/meeting/
```

旧 CLI の `create ...` / `extract -d ...` 形式と旧 flat レイアウトは、いずれも自動移行・互換読み取りしません。

## テスト

```bash
pnpm --filter @modular-prompt/extract test:run
```

MLX 統合テストは macOS + MLX 設定がある環境でのみ実行される。

## 関連ドキュメント

- [API 仕様](./API.md)
- [プロンプトモジュール仕様](../../docs/PROMPT_MODULE_SPEC.md)
- [プロンプトキャッシュ設計](../../docs/CACHE_DESIGN.md)
- [ローカルモデルセットアップ](../../docs/LOCAL_MODEL_SETUP.md)
- 親 Issue: [#330](https://github.com/otolab/modular-prompt/issues/330)
