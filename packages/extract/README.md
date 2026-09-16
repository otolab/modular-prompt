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

## クイックスタート（MLX / PyTorch）

### CLI

ビルド後、ワークスペース内では次のように実行できる。

```bash
pnpm --filter @modular-prompt/extract build

# 1. 入力ファイルから meeting store を作成（デフォルト: ~/.modular-prompt/extract-cache）
node packages/extract/bin/modular-prompt-extract.js create meeting -m 'your-mlx-model' docs/*.txt

# PyTorch モデルを使う場合は provider を明示できる（models.yaml の provider でも自動判定）
node packages/extract/bin/modular-prompt-extract.js create meeting-pytorch \
  -m 'local-pytorch' --provider pytorch docs/*.txt

# 2. 既存 store にファイルを追加（incremental prefill）
node packages/extract/bin/modular-prompt-extract.js add meeting docs/day2.txt

# 3. 抽出クエリ（cue）を実行 — 結果は stdout
node packages/extract/bin/modular-prompt-extract.js extract meeting '登場人物を列挙'

# 4. コンテナ内の store を一覧表示
node packages/extract/bin/modular-prompt-extract.js list

# 5. store 単位のキャッシュ削除
node packages/extract/bin/modular-prompt-extract.js clean meeting
```

| コマンド | 説明 |
|---------|------|
| `create <storename> [-d <container>] [-m <alias-or-model-id>] [--provider <mlx\|pytorch>] [files...]` | corpus を読み込み KV cache を準備。provider と model を含む `manifest.json` を `<container>/<storename>/` に保存 |
| `add <storename> [-d <container>] [files...]` | 既存 store の corpus にファイルを追記し、KV cache を incremental prefill で拡張 |
| `extract <storename> [-d <container>] [query...]` | 指定 store のキャッシュ済み corpus に対して抽出。query が cue になる |
| `list [-d <container>]` | コンテナ内の全 store と manifest/KV のサマリを表示 |
| `clean <storename> [-d <container>]` | 指定 store の manifest + KV キャッシュを再帰削除。存在しない store は no-op |
| `clean --all [-d <container>]` | コンテナ全体を再帰削除。存在しないコンテナは no-op |
| `extract <storename> --max-tokens <n>` | 最大生成トークン数（デフォルト: 8000） |
| `--provider <mlx\|pytorch>` | create で provider を明示。省略時は models.yaml / model alias から解決 |
| `--dry-run` | driver を起動せず、compile 済みプロンプト全文を stdout に出力 |

`list` は各 store の model、materials 数・タイトル、作成日時、KV cache の有無を表示します。

CLI の `create` / `add` は入力ファイルを UTF-8 の文字列として読み込みます。画像ファイルを `Attachment` に変換する機能はなく、CLI の画像 material は Phase 3 の対象外です。画像を corpus に含める場合は library API の `MaterialInput.content: Attachment[]` を使用してください。MLX VLM の画像入力・画像 cache が受け付けるのは local file path のみで、URL や data URI は未対応です。

```text
Store: meeting
  Model: mlx-community/SomeModel-4bit
  Provider: mlx
  Materials: 2 (notes.txt, meeting.md)
  Created: 2026-09-07T03:00:00.000Z
  Updated: 2026-09-07T04:00:00.000Z
  KV cache: present
```

```bash
# プロンプト確認（create）
modular-prompt-extract create meeting --dry-run docs/notes.txt

# プロンプト確認（extract — store の manifest が必要）
modular-prompt-extract extract meeting --dry-run '登場人物を列挙'
```

`-d` 省略時のデフォルトは `~/.modular-prompt/extract-cache` で、create/add/extract/list/clean 共通の **store コンテナ**を指定します。`MODULAR_PROMPT_HOME` を設定している場合は、その値の下の `extract-cache` が使用されます。`-m` には models.yaml の alias（例: `default`）または生の HF model ID を指定できます。create/add/extract/clean では `<storename>` が必須（`clean --all` を除く）で、コンテナ配下の `<storename>/` が利用されます。

### models.yaml 連携

マシン共通のモデル定義は **`~/.modular-prompt/models.yaml`**（単一ファイル。`models/` ディレクトリは非対応）に置きます。`MODULAR_PROMPT_HOME` でホームディレクトリを変更できます。

| 順位 | ソース | 説明 |
|------|--------|------|
| 1 | CLI `-m` | 最優先。alias または生の HF model ID |
| 2 | user yaml の `models.default` | `-m` 省略時のみ使用。同梱 fallback や先頭エントリ自動選択はなし |

`-m` を省略した場合は、`models.default` が user yaml に明示されているときだけそのモデルを使います。未設定時は driver を起動せず、`-m` 指定または `models.default` 定義を案内するエラーを返します。モデル alias に `provider: mlx` または `provider: pytorch` を設定すると provider を自動判定できます。provider を推論できない生 model ID は、`create --provider mlx` / `create --provider pytorch` のように明示してください。create は解決後の生 model ID と provider を store の `manifest.json` に保存し、以降の add/extract は manifest の provider + model を検証して同じ cache runtime を使います。provider の異なる store は cache 形式が非互換のため開けません。

ローカルテスト用のモデルは `~/.modular-prompt/models.testing.yaml` に分けて置き、手元の extract 実行では `MODULAR_PROMPT_MODELS_PROFILE=testing` を指定できます。設定ファイルのサンプルと統合テストの convention alias は [ローカルモデルセットアップガイド](./docs/LOCAL_MODEL_SETUP.md) を参照してください。

たとえば `~/.modular-prompt/models.yaml` に次を置くと、`create meeting -m default` と `create meeting` の両方でこのモデルが選ばれます。

```yaml
models:
  default:
    provider: mlx
    model: mlx-community/YourModel-4bit
```

PyTorch (Transformers) の text-only extract は、次のように `driverOptions.device` / `venvPath` を設定できます。CUDA の場合は driver 側の runtime 構成に従います。

```yaml
models:
  local-pytorch:
    provider: pytorch
    model: meta-llama/Llama-3.2-3B-Instruct
    driverOptions:
      device: cuda
      venvPath: ~/.modular-prompt/runtimes/pytorch/.venv
```

モデルが設定されていない構成では、`-m <model-id-or-alias>` を指定するか、user yaml に `models.default` を定義してください。

**MLX バックエンドは models.yaml の指定に従う**。未指定時は `auto` で、モデル種別に応じて `mlx-lm` / `mlx-vlm` を選択する。`backend: 'vlm'` を指定した VLM 判定モデルは、画像なしの text-only exact KV cache に加えて、画像 material を含む prompt の vision cache もディスクへ保存して extract session 間で再利用できる。画像あり VLM cache は text-only VLM / LM の store とは別 namespace・非互換で、VLM の incremental prefill は対象外。PyTorch runtime は現状 text-only で、MLX の `backend` / `maxImageSize` は無視されます。

```yaml
models:
  default:
    provider: mlx
    model: mlx-community/Your-VLM-4bit
    driverOptions:
      backend: vlm  # 省略時は auto
```

### ライブラリ API

```typescript
import {
  createExtractSession,
  createMlxExtractRuntime,
  createPytorchExtractRuntime,
} from '@modular-prompt/extract';

const runtime = await createMlxExtractRuntime({
  model: 'your-mlx-model',
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

// PyTorch の場合も同じ ExtractSession API を使う
const pytorchRuntime = await createPytorchExtractRuntime({ model: 'local-pytorch' });
// pytorchRuntime.driver / pytorchRuntime.cacheController を同じように session へ渡す
await pytorchRuntime.close();
```

## キャッシュの意図と制約

### 削除タイミング

| タイミング | 何が起きるか |
|-----------|-------------|
| `session.close()`（デフォルト） | handle を `release` マーク → 次の `runtime.close()` で **KV ファイル削除** |
| `session.close({ releaseCache: false })` | release しない → **KV ファイルは disk に残る**（CLI はこちら） |
| `runtime.close()`（固定 cacheDir） | `release` 済みエントリの LM/VLM cache files を削除 |
| `runtime.close()`（一時 cacheDir） | **ディレクトリごと削除** |
| `add <storename> files...` | 既存 store を staging にコピーし、必須 cache prepare（空 handle は失敗）と manifest 更新が成功した後に入れ替え |
| `clean <storename> [-d <container>]` | 1 store の manifest + KV キャッシュを再帰削除 |
| `clean --all [-d <container>]` | コンテナ内の全 store を再帰削除 |

`create` 直後に store 内へ `manifest.json` だけ残って cache file が無い場合、以前のバージョンでは `session.close()` が release していたのが原因。CLI は `releaseCache: false` で修正済み。

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

`cacheController` は **必須**。`createMlxExtractRuntime` / `createPytorchExtractRuntime` の `model` は省略でき、CLI と同じ user models.yaml の `models.default` 解決を行います。provider を明示的に選ぶ場合は `createExtractRuntime({ model, provider })` を使えます。モデル設定がない場合や provider を推論できない生 ID はエラーになります。PyTorch runtime は text-only で、`driverOptions.device` / `venvPath` は models.yaml から渡されます。キャッシュ非対応モードは提供しない。

詳細は [プロンプトキャッシュ設計](./docs/CACHE_DESIGN.md) および [API 仕様](./docs/API.md) を参照。

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
| `createPytorchExtractRuntime` | PyTorch 用 driver + cacheController バンドル（text-only） |
| `createExtractRuntime` | 解決済み provider に応じた runtime factory |
| `resolveModelSpec` | alias または生 model ID から extract 用 ModelSpec を解決 |
| `createDriver` | 解決済み ModelSpec から AIService 経由で MLX / PyTorch driver を生成 |
| `resolveDefaultContainerDir` | `MODULAR_PROMPT_HOME` に基づくデフォルト cache container を解決 |
| `resolveStoreDir` | cache コンテナと storename から store ディレクトリを解決 |
| `validateStorename` | storename の形式と予約語を検証 |
| `defaultExtractBaseModule` | デフォルト base モジュール |
| `mergeExtractBaseModule` | デフォルト base に overlay を merge |
| `buildPreviousExtractionsInputs` | 過去抽出結果を inputs に変換 |
| `inputChunk` / `inputChunksFromJson` | chunk 入力ヘルパ |

型: `ExtractCorpus`, `ExtractRequest`, `ExtractResult`, `ExtractSession`, `MaterialInput`, `MessageInput`, `ChunkInput` など。

完全な API リファレンスは [API.md](./docs/API.md) を参照。

## CLI（`modular-prompt-extract`）

`bin/modular-prompt-extract.js` 経由で利用できる簡易 CLI。

```bash
pnpm --filter @modular-prompt/extract build

modular-prompt-extract create meeting [-d <cache-dir>] [-m <alias-or-model-id>] [--provider <mlx|pytorch>] file1.txt file2.txt
modular-prompt-extract add meeting [-d <cache-dir>] file3.txt
modular-prompt-extract create contract [-d <cache-dir>] [-m <alias-or-model-id>] contract.pdf
modular-prompt-extract extract meeting [-d <cache-dir>] '抽出したい内容の指示'
modular-prompt-extract extract contract [-d <cache-dir>] '契約期間を抽出'
modular-prompt-extract list [-d <cache-dir>]
modular-prompt-extract clean meeting [-d <cache-dir>]
modular-prompt-extract clean --all [-d <cache-dir>]
```

`<storename>` は create/add/extract/clean の positional 第1引数で必須です（`clean --all` を除く）。`[a-zA-Z0-9][a-zA-Z0-9_-]*` に一致し、`create`・`add`・`extract`・`list`・`clean` は使用できません。`-d` は store コンテナを指定し、create は `<container>/<storename>/` にキャッシュと `manifest.json` を保存します。既存 store に対する create は失敗するため、`modular-prompt-extract clean <storename>`（必要に応じて `-d <container>`）で削除してから再実行します。

`add <storename> files...` は manifest の provider + model を検証して既存 store に資料を追加します。新しいファイルは絶対パスを `id` として追記され、同じ `id`・同じ内容の再追加はスキップされます。同じ `id` の内容が変わっている場合は、キャッシュとの不整合を避けるためエラーになります。その場合は `clean` してから `create` し直してください。`add --dry-run` は driver を起動せず、マージ後のプロンプトを表示します。

`add` は既存 store を直接上書きしません。staging store で必須 cache prepare と manifest 書き込みを完了してから store ディレクトリを入れ替えるため、空 handle を含む prefill の失敗、または manifest 更新の失敗時は既存の corpus と KV cache が保持されます。通常の `createExtractSession` / `extract` は引き続き cache prepare の失敗を best-effort で扱います。

`-m` は models.yaml の alias（`default` など）または生の HF model ID を受け付けます。省略時は user の `~/.modular-prompt/models.yaml` にある `models.default` から解決します。モデルが未設定の場合は明示的な `-m` または `models.default` が必要です。生 model ID の provider を推論できない場合は `--provider mlx` / `--provider pytorch` を指定してください。`create` は解決後の生 model ID と provider を store 内の `manifest.json` に保存し、`extract` と `add` は manifest の provider + model を検証して再開します。backend がない既存 MLX manifest は `auto` として扱うため、従来どおりモデル種別の自動判定になります。VLM は text-only cache と画像 material 用の vision cache を別 namespace で使用し、VLM incremental prefill は対象外です。PyTorch は現状 text-only です。

### 旧 CLI / キャッシュレイアウトからの移行

デフォルト cache container の変更は破壊的変更です。旧 `./.extract-cache` は自動検出・自動移行しません。#353 以降の named store レイアウトを使用していた場合は、必要な store を新しいデフォルト配下へ手動で移動してください。`MODULAR_PROMPT_HOME` を設定している場合は、移行先の `~/.modular-prompt` を設定値に置き換えます。

```bash
# 例: named store の meeting を旧 .extract-cache から移行
mkdir -p ~/.modular-prompt/extract-cache
mv ./.extract-cache/meeting ~/.modular-prompt/extract-cache/
```

移行後は新形式で `modular-prompt-extract extract meeting '...'` を実行します。複数の store がある場合は、それぞれ移動してください。

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

- [API 仕様](./docs/API.md)
- [プロンプトモジュール仕様](./docs/PROMPT_MODULE_SPEC.md)
- [プロンプトキャッシュ設計](./docs/CACHE_DESIGN.md)
- [ローカルモデルセットアップ](./docs/LOCAL_MODEL_SETUP.md)
- 親 Issue: [#330](https://github.com/otolab/modular-prompt/issues/330)
