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

# 1. 入力ファイルからキャッシュ作成（デフォルト: ./.extract-cache）
node packages/extract/bin/modular-extract.js create -m 'your-mlx-model' docs/*.txt

# 2. 抽出クエリ（cue）を実行 — 結果は stdout
node packages/extract/bin/modular-extract.js extract -d .extract-cache '登場人物を列挙'

# キャッシュ削除
rm -rf .extract-cache
```

| コマンド | 説明 |
|---------|------|
| `create [-d <dir>] [-m model] [files...]` | corpus を読み込み KV cache を準備。`manifest.json` を dir に保存 |
| `extract -d <dir> [query...]` | キャッシュ済み corpus に対して抽出。query が cue になる |
| `extract --max-tokens <n>` | 最大生成トークン数（デフォルト: 8000） |
| `--dry-run` | MLX を起動せず、compile 済みプロンプト全文を stdout に出力 |

```bash
# プロンプト確認（create）
modular-extract create --dry-run docs/notes.txt

# プロンプト確認（extract — manifest が必要）
modular-extract extract --dry-run -d .extract-cache '登場人物を列挙'
```

`-d` 省略時のデフォルトは `./.extract-cache`。`-m` 省略時は `MLX_MODEL` 環境変数、未設定ならパッケージ既定モデル。

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
| `runtime.close()`（固定 cacheDir） | `release` 済みエントリの `.safetensors` を削除 |
| `runtime.close()`（一時 cacheDir） | **ディレクトリごと削除** |
| `rm -rf <cache-dir>` | manifest + KV キャッシュを手動削除（CLI のクリーン方法） |

`create` 直後に `manifest.json` だけ残って `.safetensors` が無い場合、以前のバージョンでは `session.close()` が release していたのが原因。CLI は `releaseCache: false` で修正済み。

### 意図

- **corpus（materials / messages）** はセッション内で不変 → 1 回 prefill すれば再利用
- **inputs** は呼び出しごとに増える → incremental prefill でキャッシュを伸ばす
- **cue** は毎回変わる → output セクションのためキャッシュ対象外

### 制約

| 変更内容 | 対応 |
|---------|------|
| `corpus` を変えたい | **新しいセッション**を作る |
| `baseModule` を変えたい | **新しいセッション**を作る |
| 前回の抽出結果を参照したい | 次の `extract()` の `inputs` に明示的に渡す（自動累積しない） |
| driver / cacheController の終了 | 呼び出し側の責務（`runtime.close()` 等） |
| セッション終了 | `session.close()` — デフォルトで handle `release()`。固定 cacheDir を残す場合は `{ releaseCache: false }` |

`cacheController` と `model` は **必須**。キャッシュ非対応モードは提供しない。

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

modular-extract create [-d .extract-cache] [-m model] file1.txt file2.txt
modular-extract extract -d .extract-cache '抽出したい内容の指示'

# キャッシュ削除
rm -rf .extract-cache
```

`create` は入力ファイルを corpus として KV cache を準備し、`manifest.json` を cache ディレクトリに保存する。`extract` は manifest から corpus を復元して cue を実行する。いずれも **mlx-lm バックエンド固定**（キャッシュ互換のため）。

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
