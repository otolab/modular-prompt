# プロンプトキャッシュ設計

プロンプトキャッシュシステムの設計思想とキャッシュライフサイクル管理の仕様。

## 目次

- [概要](#概要)
- [対象読者](#対象読者)
- [PromptCacheControllerインターフェース](#promptcachecontrollerインターフェース)
- [CacheHandle](#cachehandle)
- [retain / release ヒント機構](#retain--release-ヒント機構)
- [実装](#実装)
  - [MlxCacheController](#mlxcachecontroller)
  - [PyTorchCacheController](#pytorchcachecontroller)
  - [GoogleGenAICacheController](#googlegenaicachecontroller)
- [ファイルロック機構](#ファイルロック機構)
- [Incremental Prefillとsupersedes](#incremental-prefillとsupersedes)
- [QueryResult.usage との関係](#queryresultusage-との関係)
- [関連ドキュメント](#関連ドキュメント)

## 概要

PromptCacheControllerは、プロンプトキャッシュのライフサイクルを管理するインターフェースです。キャッシュの準備・再利用・削除を統一的に扱い、各AIサービスの特性に応じた実装を提供します。

対応実装:
- **MlxCacheController** - KVキャッシュファイルを管理（Apple Silicon最適化）
- **PyTorchCacheController** - PyTorch backend 固有の KV キャッシュファイルを管理
- **GoogleGenAICacheController** - GoogleGenAI APIのキャッシュ機能を管理

## 対象読者

- **フレームワーク利用者** - PromptCacheControllerを使ってキャッシュを活用する開発者
- **フレームワーク貢献者** - キャッシュコントローラーを実装する開発者

## PromptCacheControllerインターフェース

```typescript
export interface PromptCacheController {
  recordQuery?(): void;
  prepare(params: CachePrepareParams): Promise<CacheHandle>;
  release(ref: string): void;
  close(): Promise<void>;
}
```

### prepare(params)

キャッシュを準備し、`CacheHandle`を返します。同一パラメータの場合は既存キャッシュを再利用します。

```typescript
export interface CachePrepareParams {
  model: string;
  instructions?: Element[];
  data?: Element[];
  tools?: ToolDefinition[];
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** VLM image sources belonging to the cacheable prefix. */
  images?: string[];
  /** Maximum image edge used for VLM preprocessing. */
  maxImageSize?: number;
}
```

**動作**:
- 同じパラメータで呼ばれた場合、メモリまたはディスクから既存キャッシュを返す
- 新規の場合、キャッシュを作成してCacheHandleを返す
- incremental prefillが可能な場合、既存キャッシュをベースに差分のみをprefill

**戻り値**: `Promise<CacheHandle>`

### release(ref)

「もう要らない」というヒントを送ります。即座の削除を保証しません。

**動作**:
- メモリキャッシュから即座に除外（再利用候補から外れる）
- ファイルやAPIリソースの削除タイミングは実装依存
- MlxCacheController / PyTorchCacheController: `close()`時にrelease済みエントリを削除
- GoogleGenAICacheController: 即座にAPIサーバー側リソースを削除

**パラメータ**:
- `ref` - CacheHandle.refの値

### close()

リソースのクリーンアップを行います。

**動作**:
- インフライトリクエストの完了を待つ
- 管理対象キャッシュの削除
- release済みエントリの実際の削除（MlxCacheController / PyTorchCacheController）

**戻り値**: `Promise<void>`

### recordQuery() (オプション)

クエリ統計の記録。ドライバーがquery実行時に呼び出します。

## CacheHandle

キャッシュの参照と、キャッシュに含まれる内容を示すメタデータ。

```typescript
export interface CacheHandle {
  ref: string;
  trimTokens?: number;
  includes: {
    instructions: boolean;
    dataElementCount: number;
    tools: boolean;
  };
  supersedes?: string;
}
```

### フィールド

**ref**

キャッシュの一意な参照。
- MlxCacheController (LM): ファイルパス（例: `/tmp/mlx-prompt-cache-abc123/def456.safetensors.zip`）
- MlxCacheController (VLM): `mlx-vlm` exact snapshot のファイルパス（text-only の例: `/tmp/mlx-prompt-cache-abc123/def456.vlm.safetensors/exact_<hash>.safetensors`、画像ありは `.vlm-vision.safetensors` namespace）
- PyTorchCacheController (LM): backend 固有のファイルパス（例: `/tmp/pytorch-prompt-cache-abc123/def456.pytorch-cache`）
- GoogleGenAICacheController: API名（例: `cachedContents/xyz789`）

#### mlx-vlm 0.7.0（Phase 2–3）

VLM の text-only ref はディスク上の `exact_cache_v1` snapshot です。作成元 Python process の終了・再起動後も、固定 `cacheDir` の `cache-index.json` に記録された実体（`cacheDir` 相対 path）からロードできます。相対 path にすることで、extract の staging directory を rename しても index を再利用できます。`mlx-vlm-memory://` は Phase 1 互換の明示 ref に限った process-local fallback であり、MlxCacheController や extract の主経路では使用しません。

- `make_prompt_cache(model.language_model, max_kv_size=None)` で空の prompt cache を生成
- `stream_generate(..., prompt_cache=cache)` で prefill / cached suffix generation に cache を渡す
- `apc_adapters.clone_cache_entry(entry, *, min_capacity_tokens, eval_targets)` で generation 前に cache entry を複製

ディスク保存には 0.7.0 の `DiskBlockStore` を使います。論理 cache path を専用 namespace として `DiskBlockStore(root, namespace, num_workers=1)` を開き、prefill 後に次を呼びます。

- `save_exact_cache(cache_hash, token_ids, extra_hash, prompt_cache)` — cache 全体を非同期 snapshot として保存
- `close()` — writer queue を drain して保存完了を確定
- `load_exact_cache(cache_hash)` — `exact_<hash>.safetensors` を復元

`APCManager.store_exact_cache()` / `lookup_exact_cache()` も調査しましたが、これは APC のメモリ LRU・prefix lookup と連動する API です。Phase 2–3 は TypeScript controller が完全一致キーを管理し、VLM incremental prefill を行わないため、backend では直接 `DiskBlockStore.save_exact_cache` / `load_exact_cache` を採用しています。保存形式の metadata は `layout: exact_cache_v1`、`cache_hash`、`extra_hash`、`token_ids`、cache entry 数などです。

VLM の text-only 論理 path が `/cache/<key>.vlm.safetensors` の場合、実体は `/cache/<key>.vlm.safetensors/exact_<hash>.safetensors`、sidecar は実体 path に `.meta.json` を付けた `/cache/<key>.vlm.safetensors/exact_<hash>.safetensors.meta.json` です。sidecar には LM と同じ `token_count`、`prefix_offsets`、`prefix_hashes` を保存し、さらに backend 固有の `layout: exact_cache_v1` / `cache_hash` を持ちます。load 時は sidecar の `cache_hash` から導出した exact snapshot path と実際の ref を照合し、mismatched sidecar、snapshot 不在、破損 snapshot は cache load failure として cold path に落とします。`.vlm.safetensors` は APC namespace directory の名前であり、実体の拡張子は `.safetensors` です。

LM の `.safetensors.zip`（zip 内 `prompt_cache.safetensors`）と VLM の snapshot は別形式で、相互に読み込みません。

##### 画像あり VLM（Phase 3）

画像を含む cacheable prefix は、text-only VLM とは別の `/cache/<key>.vlm-vision.safetensors/` namespace に保存します。実体の snapshot codec は mlx-vlm 0.7.0 の `DiskBlockStore.save_exact_cache()` ですが、modular-prompt の `vision_cache_v1` sidecar と namespace を含む保存契約は text-only の `exact_cache_v1` と非互換です。LM の `.safetensors.zip` とも非互換です。text-only ref を画像付き query に、画像付き ref を text-only query に渡した場合は load を拒否して cold path に戻します。

画像付き snapshot の sidecar には次を保存します（token IDs 本体は DiskBlockStore の exact snapshot metadata に保存します）。

- `layout: vision_cache_v1`、`backend: mlx-vlm`、`cache_hash`、`token_count`
- APC exact snapshot に渡した `extra_hash` と表示用の `image_hash`
- `image_count`、`image_refs`、`max_image_size`
- `vision_feature_cache_version: mlx-vlm-0.7.0`

`MlxVlmBackend` は mlx-vlm 0.7.0 の `VisionFeatureCache` を process-local に保持し、`stream_generate(..., vision_cache=...)` を通じて upstream が `cached_image_features` をモデルへ渡す経路を使います。0.7.0 の upstream PIL key は `tobytes()` のみなので、backend は wrapper を挟み、mode・寸法・bytes と画像列 index を含む digest string を upstream cache に渡します。これにより同じ bytes 長でも mode / 寸法が異なる画像の feature が誤共有されません。永続化するのは prompt/KV exact snapshot と sidecar の同一性情報であり、opaque な MLX の projected feature tensor 自体は保存しません。プロセス再起動後は画像を再処理して feature cache を再構築します。

画像同一性は、`load_and_resize_images()` 後の正規化済み PIL payload（mode、幅・高さ、bytes）を hash して `extra_hash` にします。mlx-vlm dispatch 前の pixel tensor は backend から直接取得できないため、prefill と load が同じ modular-prompt 側の正規化入力を検証できる設計にしています。これにより、同一 token 列でも画像が異なる場合は別の `extra_hash` / controller key になり、resize 条件が異なる場合も cache miss になります。load 時は sidecar の layout、hash、画像数、resize 条件、feature cache version、exact snapshot の token 数と `extra_hash` を検証し、さらに保存済み token IDs が現行 prompt の prefix と一致することを確認します。失敗時は `cache_loaded: false` の cold path です。

画像付き VLM は新規 prompt の fresh prefill と exact load に限定します。`base_cache_path`、`trim_to_tokens`、VLM incremental prefill / prefix reuse は本 Phase でも対象外です。

依存関係では 0.7.0 が `mlx>=0.32.2`、`mlx-audio>=0.4.8`、`jinja2>=3.1.0` を要求するため、lock file は `mlx-audio==0.5.3` として解決しています。`mlx`、`mlx-lm`、`transformers` の既存 pin / override は維持しています。

**trimTokens**

KVキャッシュを指定トークン数にトリムして読み込む（incremental prefill用）。

- 指定時、キャッシュファイルの先頭N個のトークンのみを使用
- incremental prefillでベースキャッシュとの共通プレフィックス長を指定

**includes**

キャッシュに含まれる内容のフラグ。ドライバーが重複コンテンツ送信を避けるために使用。

- `instructions` - システムプロンプト等が含まれるか
- `dataElementCount` - データ要素の個数
- `tools` - ツール定義が含まれるか

**supersedes**

incremental prefillで置き換えられた元キャッシュのref。

- 新しいキャッシュ作成時にベースとして使われた古いキャッシュを示す
- このフィールドが設定されると、元キャッシュは自動的に`release()`される

## retain / release ヒント機構

キャッシュの保守に「ヒント（意図表明）モデル」を採用しています。

### 設計の背景

キャッシュは「あってもなくてもよい」性質を持ちます。この特性から:

- **作成は自動的** - 必要に応じてフレームワークが自動生成
- **削除を利用側に明示的に設計させるのは非対称で負担が大きい**
- **利用側は「もう要らない」という意図を伝えるだけでよい**
- **実際の削除タイミングはコントローラーの責務**

### 2つの状態

**retain（デフォルト）**

キャッシュを保持する状態。`prepare()`の再利用候補となります。

**release**

「もう要らない」というヒント。以下の効果があります:

- メモリキャッシュから即座に除外される
- `prepare()`の再利用候補から外れる
- ファイルやAPIリソースの削除タイミングは実装依存

### release()を呼んでも

**MlxCacheController / PyTorchCacheController**:
- ファイルは即座に削除されない
- `cache-index.json`のエントリに`hint: 'release'`が記録される
- `close()`時にrelease済みエントリのファイルが削除される
- 外部プロセス（`sprite-claude cache clean`等）もrelease済みエントリを削除対象にできる

**GoogleGenAICacheController**:
- APIサーバー側リソースが即座に削除される（課金対象の可能性があるため）

## 実装

### MlxCacheController

Apple Siliconに最適化されたMLXモデル用のKVキャッシュ管理。

**特徴**:
- LM は `.safetensors.zip`形式でKVキャッシュをファイル保存（zip内エントリは`prompt_cache.safetensors`）
- LM の保存時はsafetensorsの出力ストリームをzipエントリへ直接渡し、非圧縮ファイルを作成しない
- LM は既存の非圧縮`.safetensors`キャッシュを読み込まない
- incremental prefillサポート（既存キャッシュをベースに差分のみprefill）
- トークンレベルのプレフィックス照合（prefix_hashes）
- 固定キャッシュディレクトリモードとmanaged一時ディレクトリモード
- VLM は text-only の `exact_cache_v1` と画像付きの `vision_cache_v1` を専用 namespace へ保存
- VLM の画像 feature tensor は process-local、incremental prefill と LM cache との相互利用は対象外

**キャッシュディレクトリモード**:

| モード | `managedDir` | `cacheDir` | 説明 |
|--------|-------------|-----------|------|
| 一時ディレクトリ | `true` | 未指定 | プロセス終了時に自動削除 |
| 固定ディレクトリ | `false` | 指定あり | `close()`でrelease済みのみ削除。`cache-index.json`で状態管理 |

**cache-index.json**:

固定ディレクトリモード時、以下の情報を記録:

```typescript
interface CacheIndexEntry {
  key: string;
  model: string;
  formatterOptionsHash: string;
  elementHashes: string[];
  toolsHash?: string;
  reasoningEffort?: string;
  createdAt: string;
  hint?: 'retain' | 'release';
  /** キャッシュ形式の backend（省略時は旧 LM エントリ） */
  backend?: 'lm' | 'vlm' | 'pytorch';
  /** backend cache の cacheDir 相対 path（必要な backend のみ） */
  path?: string;
}
```

**incremental prefillフロー**:

1. 新しい`prepare()`呼び出し
2. `findBestBase()` - 要素ハッシュの前方一致でベースキャッシュを選定
3. トークンレベルのプレフィックス照合（prefix_hashes）で共通トークン数を確認
4. ベースキャッシュのKV値を再利用し、差分のみprefill
5. 新キャッシュの`supersedes`にベースキャッシュのrefを記録
6. ベースキャッシュを自動的に`release()`

### TransformersLmBackend（PyTorch）

PyTorch の Transformers LM は、MLX とは互換でない backend 固有の
`pytorch_kv_v1` 形式を使用します。

- cache 本体は `torch.save` の payload として指定された cache path に保存
- payload には KV state と、load 時の prefix 検証に使う token IDs を保存
- `<cache path>.meta.json` には `layout`、`token_count`、`prefix_offsets`、
  `prefix_hashes`、`model_id`、`dtype`、`device` を保存
- load 時に layout、token 数、prompt prefix、model ID、dtype、device を検証し、
  不一致・破損・欠損は cache miss として cold path に戻す
- `base_cache_path` と `trim_to_tokens` を指定した場合は、base cache を clone・trim
  して suffix だけを prefill し、新しい cache と meta を保存
- `memory://` ref は Phase 1 互換の process-local cache として扱い、ファイルを作成しない

PyTorch の cache payload は Transformers の legacy tuple と `Cache` の KV layer を
扱います。`Cache` の trim は clone に対して論理 token 数を更新し、static cache の容量は
維持します。元の cache ref は変更されません。
PyTorch の cache は MLX / provider 間で共有しません。

#### PyTorchCacheController

`PyTorchCacheController` は上記の `cache_prefill` / `generate` 契約を
`PromptCacheController` に適合させ、要素・tools・formatter・reasoning の組み合わせから
cache key を作ります。`PyTorchDriver` の `cacheController` に渡すと、
`LocalInferenceDriver` の `onCapabilitiesLoaded` 後に backend process へ bind されます。

- cache 本体は `<key>.pytorch-cache`、sidecar は `.meta.json` とし、index には
  `backend: 'pytorch'` を記録する
- 固定 `cacheDir` では index の相対 path とファイルロックを使い、release 済みの
  PyTorch entry だけを `close()` 時に削除する
- managed directory（`cacheDir` 未指定）は process 終了時に一時ディレクトリを削除する
- CPU backend の prefix metadata が利用できる場合は、要素と token prefix を照合して
  incremental prefill を行う。CUDA backend がこの metadata を拒否する場合は plain prefill
  にフォールバックする
- VLM / 画像入力では controller を bind せず、cache を無効にする

### GoogleGenAICacheController

GoogleGenAI APIのキャッシュ機能を管理。

**特徴**:
- APIサーバー側でキャッシュを管理
- TTL（有効期限）ベースの自動削除
- release時に即座にサーバー側リソースを削除

**設定**:

```typescript
interface GoogleGenAICacheControllerConfig {
  ttl?: string;  // デフォルト: '3600s'
  displayName?: string;
}
```

**TTL管理**:
- キャッシュ作成時にTTLを指定
- ローカルで期限切れキャッシュを掃除（`sweepExpired()`）
- サーバー側でも自動削除される

## ファイルロック機構

MlxCacheControllerは、固定キャッシュディレクトリモード（`managedDir: false`）時に`cache-index.json`の読み書きに対してファイルロックを使用します。

### 目的

- 同一マシン上で複数プロセスが同じキャッシュディレクトリを共有する場合の安全性確保
- 外部プロセス（`sprite-claude cache clean`等）からの安全なキャッシュ操作

### 実装

`proper-lockfile`ライブラリによるアドバイザリロックを使用:

```typescript
import { lock as lockFile } from 'proper-lockfile';

// 読み込み時
const release = await lockFile(this.indexPath, { realpath: false });
try {
  const raw = await readFile(this.indexPath, 'utf-8');
  // ... parse and use
} finally {
  await release();
}

// 書き込み時
const release = await lockFile(this.indexPath, { realpath: false });
try {
  await writeFile(this.indexPath, JSON.stringify(this.cacheIndex, null, 2));
} finally {
  await release();
}
```

### 対象

- **固定ディレクトリモード**（`managedDir: false`）のみ
- **一時ディレクトリモード**（`managedDir: true`）はプロセス間共有がないためロック不要

## Incremental Prefillとsupersedes

MlxCacheController と PyTorchCacheController（LM）は、既存キャッシュをベースに差分のみをprefillする「incremental prefill」をサポートします。PyTorch の CUDA runtime のように backend が incremental metadata を受け付けない場合は plain prefill にフォールバックします。

MLX VLM の text-only (`exact_cache_v1`) と画像付き (`vision_cache_v1`) は完全一致の disk hit / fresh prefill に限定し、`findBestBase()`、`base_cache_path`、`trim_to_tokens`、prefix reuse は no-op とします。PyTorch VLM / 画像入力の cache は現行 backend で無効です。

### フロー

1. **新しいprepare()呼び出し**
   - 新しいプロンプトに対してキャッシュを準備

2. **ベース選定（findBestBase）**
   - 要素ハッシュ（elementHashes）の前方一致でベースキャッシュ候補を抽出
   - トークンレベルのプレフィックス照合（prefix_hashes）で最長一致を確認
   - 最も多くのトークンを再利用できるキャッシュを選定

3. **incremental prefill実行**
   - ベースキャッシュのKV値をロード
   - `trimTokens`で共通プレフィックス長を指定
   - 差分のみをprefillして新キャッシュを作成

4. **supersedes記録**
   - 新キャッシュの`supersedes`フィールドにベースキャッシュのrefを記録

5. **自動release**
   - ベースキャッシュを自動的に`release()`
   - メモリキャッシュから除外され、`cache-index.json`に`hint: 'release'`が記録される

### prefix_hashes

各キャッシュファイルには、トークンプレフィックスのハッシュ情報が`.meta.json`として保存されます:

```typescript
interface PrefixMeta {
  token_count: number;
  prefix_offsets: number[];  // [100, 200, 500] など
  prefix_hashes: string[];   // 各offsetまでのトークン列のSHA-256ハッシュ
}
```

これにより、要素ハッシュが部分一致する場合でも、実際のトークン列での共通プレフィックス長を正確に検証できます。

### 利点

- **プロンプトが段階的に拡張される場合に効率的**
  - 例: instructions固定、dataが増加
- **prefillコストの削減**
  - 共通部分のprefillを省略し、差分のみ処理
- **自動クリーンアップ**
  - 古いキャッシュが自動的にreleaseされる

## QueryResult.usage との関係

プロンプトキャッシュの利用状況は、ドライバーが `QueryResult.usage` の任意フィールドとして報告します。

```typescript
usage?: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;   // 今回リクエストでキャッシュから読んだトークン数
  cacheWriteTokens?: number;  // 今回リクエストでキャッシュに新規書き込みしたトークン数
};
```

### MlxCacheController + MlxDriver

| フィールド | ソース |
|---|---|
| `promptTokens` | Python ストリーム終端 meta の `prompt_tokens` |
| `completionTokens` | Python ストリーム終端 meta の `generation_tokens` |
| `cacheReadTokens` | クエリで使用した KV キャッシュのトークン数（LM/VLM とも `.meta.json`。VLM の exact snapshot は `token_count` を使用） |
| `cacheWriteTokens` | 同一 `streamQuery` 内の `prepare()` で新規作成した prefill トークン数（`getStats().cacheGrowthTokens` の差分） |

`promptTokens` はキャッシュ分を差し引いた値ではありません。キャッシュヒット分は `cacheReadTokens` で別途報告します。

VLM の cache load が失敗した場合、Python stream meta の `cache_loaded: false` を受けて、そのリクエストの `cacheReadTokens` は 0（フィールド省略）になります。prefill 自体が完了していれば `cacheWriteTokens` は実際に作成した prefill 分を示します。これは process restart 後の disk load 失敗にも適用されます。

### AbortSignal とキャッシュ

MLX ドライバーで `QueryOptions.signal` により推論をキャンセルする場合:

1. TS が `ProcessCommunication.cancelActiveStream()` で Node `Readable` を destroy
2. stdin に `{"method":"cancel"}\n` を送信
3. Python の `_stream_to_stdout` が `poll_cancel()` でループを抜け、`\0` でレスポンス終端
4. TS が stdout をドレインし、キューを解放（次リクエストを受け付け可能に）

キャンセル後も `MlxCacheController` が作成済みのキャッシュファイルは保持されます。`release()` / `close()` のライフサイクルは通常どおりです。

## 関連ドキュメント

- [Driver APIリファレンス](./DRIVER_API.md) - AIDriverインターフェースとドライバー一覧
- [ローカルモデルセットアップガイド](./LOCAL_MODEL_SETUP.md) - MLX、PyTorch、Ollamaのセットアップ
- [packages/driver/README.md](../packages/driver/README.md) - ドライバーパッケージの詳細
