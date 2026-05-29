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
  - [GoogleGenAICacheController](#googlegenaicachecontroller)
- [ファイルロック機構](#ファイルロック機構)
- [Incremental Prefillとsupersedes](#incremental-prefillとsupersedes)
- [関連ドキュメント](#関連ドキュメント)

## 概要

PromptCacheControllerは、プロンプトキャッシュのライフサイクルを管理するインターフェースです。キャッシュの準備・再利用・削除を統一的に扱い、各AIサービスの特性に応じた実装を提供します。

対応実装:
- **MlxCacheController** - KVキャッシュファイルを管理（Apple Silicon最適化）
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
- MlxCacheController: `close()`時にrelease済みエントリを削除
- GoogleGenAICacheController: 即座にAPIサーバー側リソースを削除

**パラメータ**:
- `ref` - CacheHandle.refの値

### close()

リソースのクリーンアップを行います。

**動作**:
- インフライトリクエストの完了を待つ
- 管理対象キャッシュの削除
- release済みエントリの実際の削除（MlxCacheController）

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
- MlxCacheController: ファイルパス（例: `/tmp/mlx-prompt-cache-abc123/def456.safetensors`）
- GoogleGenAICacheController: API名（例: `cachedContents/xyz789`）

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

**MlxCacheController**:
- ファイルは即座に削除されない
- `cache-index.json`のエントリに`hint: 'release'`が記録される
- `close()`時にrelease済みエントリのファイルが削除される
- 外部プロセス（`sprite-claude cache clean`等）もrelease済みエントリを削除対象にできる

**GoogleGenAICacheController**:
- APIサーバー側リソースが即座に削除される（課金対象の可能性があるため）

## 実装

### MlxCacheController

Apple Siliconに最適化されたMLXモデル用のKVキャッシュファイル管理。

**特徴**:
- `.safetensors`形式でKVキャッシュをファイル保存
- incremental prefillサポート（既存キャッシュをベースに差分のみprefill）
- トークンレベルのプレフィックス照合（prefix_hashes）
- 固定キャッシュディレクトリモードとmanaged一時ディレクトリモード

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
}
```

**incremental prefillフロー**:

1. 新しい`prepare()`呼び出し
2. `findBestBase()` - 要素ハッシュの前方一致でベースキャッシュを選定
3. トークンレベルのプレフィックス照合（prefix_hashes）で共通トークン数を確認
4. ベースキャッシュのKV値を再利用し、差分のみprefill
5. 新キャッシュの`supersedes`にベースキャッシュのrefを記録
6. ベースキャッシュを自動的に`release()`

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

MlxCacheControllerは、既存キャッシュをベースに差分のみをprefillする「incremental prefill」をサポートします。

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

## 関連ドキュメント

- [Driver APIリファレンス](./DRIVER_API.md) - AIDriverインターフェースとドライバー一覧
- [ローカルモデルセットアップガイド](./LOCAL_MODEL_SETUP.md) - MLXとOllamaのセットアップ
- [packages/driver/README.md](../packages/driver/README.md) - ドライバーパッケージの詳細
