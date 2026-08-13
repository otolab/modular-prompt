# Driver APIリファレンス

`@modular-prompt/driver`パッケージのAPIリファレンス。

## 目次

- [インターフェース](#インターフェース)
- [利用可能なドライバー](#利用可能なドライバー)
- [型定義](#型定義)
- [推論キャンセル（AbortSignal）](#推論キャンセルabortsignal)
- [トークン使用量（usage）](#トークン使用量usage)
- [共通ユーティリティ（query-utils）](#共通ユーティリティquery-utils)
- [エラーハンドリング](#エラーハンドリング)
- [関連ドキュメント](#関連ドキュメント)

## インターフェース

### AIDriver

すべてのドライバーが実装すべき基本インターフェース。

```typescript
interface AIDriver {
  query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult>;
  streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult>;
  close(): Promise<void>;
}
```

#### メソッド

**query()**

コンパイル済みプロンプトでAIモデルにクエリを送信。

```typescript
query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult>
```

**streamQuery()**

ストリーミングレスポンスを生成。`stream`（テキスト断片）と `result`（最終集計）は別経路です。usage は `result.usage` にのみ載せ、各チャンクには含めません。

```typescript
streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult>
```

**close()**

ドライバーのリソースをクリーンアップ。

```typescript
close(): Promise<void>
```

## 利用可能なドライバー

### クラウドサービス

| ドライバー | プロバイダー | Structured Outputs | 用途 |
|----------|------------|-------------------|------|
| OpenAIDriver | OpenAI | ✅ ネイティブ | GPT-4, GPT-3.5 |
| AnthropicDriver | Anthropic | ✅ JSON抽出 | Claude |
| VertexAIDriver | Google Cloud | ✅ ネイティブ | Gemini + Model Garden（Qwen, Llama等） |
| GoogleGenAIDriver | Google AI | ✅ ネイティブ | Gemini (API Key) |

### ローカル実行

| ドライバー | プロバイダー | Structured Outputs | 用途 |
|----------|------------|-------------------|------|
| OllamaDriver | Ollama | ✅ ネイティブ（継承） | ローカルLLM（OpenAI互換） |
| MlxDriver | MLX | ✅ JSON抽出 | Apple Silicon最適化（VLM対応） |
| PyTorchDriver | PyTorch | ✅ JSON抽出 | Transformers + PyTorch（LIP、Windows/Linux 等） |
| VllmDriver | vLLM | ✅ JSON抽出 | CUDA GPU推論（Linux） |

### テスト用

| ドライバー | プロバイダー | Structured Outputs | 用途 |
|----------|------------|-------------------|------|
| TestDriver | - | ✅ JSON抽出 | ユニットテスト、モック |
| EchoDriver | - | ✅ JSON抽出 | デバッグ、プロンプト検証 |

詳細な使用方法、設定オプション、カスタムドライバーの実装については、[packages/driver/README.md](../packages/driver/README.md)を参照してください。

## 型定義

### ChatMessage

対話メッセージの型。

```typescript
interface ChatMessage {
  role: 'system' | 'assistant' | 'user';
  content: string | Attachment[];  // MLX VLMモデルでは画像をAttachmentで指定可能
  name?: string;
}

interface Attachment {
  type: 'image';
  source: {
    type: 'url' | 'base64';
    data: string;
  };
}
```

### QueryOptions

クエリ実行時のオプション。

```typescript
interface QueryOptions {
  temperature?: number;         // 生成のランダム性 (0-2)
  maxTokens?: number;           // 最大トークン数
  topP?: number;                // トップPサンプリング
  stream?: boolean;             // ストリーミング有効化
  reasoningEffort?: 'low' | 'medium' | 'high';  // 推論深度（thinking系モデル用）
  signal?: AbortSignal;         // 推論キャンセル（未対応ドライバーは無視）
  cache?: boolean | 'read-only'; // プロンプトキャッシュ（ドライバー依存）
}
```

**signal**: 進行中の推論をキャンセルするための `AbortSignal` です。
- 呼び出し時点で `aborted` の場合、推論を開始せず `finishReason: 'error'` で `result` を resolve します
- ストリーム消費中の abort では `result` を reject しません（キャンセル判定は `signal.aborted`）
- 現時点で対応しているのは MLX ドライバーのみです

**reasoningEffort**: 推論特化モデル（OpenAI o-series、llm-jp-4-thinking等）の思考深度を制御します。
- 対応ドライバー: OpenAI（APIパラメータとして送信）、MLX（`apply_chat_template`に渡す）
- 非対応ドライバーでは無視されます

### QueryResult

クエリ結果の型。

```typescript
interface QueryResult {
  content: string;                     // テキストレスポンス
  thinkingContent?: string;            // 思考・推論チャネルの内容
  structuredOutput?: unknown;          // 構造化出力（スキーマ指定時）
  finishReason?: 'stop' | 'length' | 'error' | 'tool_calls';
  usage?: {
    promptTokens: number;       // プロンプト側トークン総数（プロバイダ報告値）
    completionTokens: number;   // 生成トークン数
    totalTokens: number;        // promptTokens + completionTokens と整合
    cacheReadTokens?: number;   // 今回リクエストでキャッシュから読んだトークン数
    cacheWriteTokens?: number;  // 今回リクエストでキャッシュに新規書き込みしたトークン数
  };
  logEntries?: LogEntry[];             // クエリ実行中のログエントリ
  errors?: LogEntry[];                 // エラーレベルのログエントリ
}
```

**thinkingContent**: モデルの思考・推論過程の内容を格納します。
- Harmonyフォーマット（llm-jp-4等）の `analysis` チャネル
- 将来的にAnthropicのthinkingブロック等にも対応予定

**usage**: トークン使用量は `stream` チャンクではなく `result.usage` にのみ載せます。
- `promptTokens` はキャッシュ分を差し引く前のプロバイダ報告値です
- `cacheReadTokens` / `cacheWriteTokens` はプロンプトキャッシュ対応ドライバーが任意で付与します（未取得時は省略または 0）
- MLX ドライバーは `prompt_tokens` / `generation_tokens` をマッピングし、KV キャッシュ利用時は `cacheReadTokens` を付与します

### StreamResult

ストリーミング結果の型。

```typescript
interface StreamResult {
  stream: AsyncIterable<string>;  // ストリームチャンク
  result: Promise<QueryResult>;   // 最終結果
}
```

### ModelSpec

モデルの仕様定義。

```typescript
interface ModelSpec {
  model: string;                    // モデル識別子
  provider: DriverProvider;         // プロバイダー名
  capabilities: DriverCapability[]; // モデルの能力
  maxInputTokens?: number;         // 最大入力トークン数
  maxOutputTokens?: number;        // 最大出力トークン数
  priority?: number;                // 優先度（低い値ほど優先）
  enabled?: boolean;                // 有効/無効フラグ
  cost?: {
    input: number;                  // 入力コスト（per 1K tokens）
    output: number;                 // 出力コスト（per 1K tokens）
  };
}
```

### DriverCapability

ドライバーの能力を表すフラグ。

```typescript
type DriverCapability =
  | 'streaming'        // ストリーミング対応
  | 'tools'            // Function Calling対応
  | 'vision'           // 画像入力対応
  | 'japanese'         // 日本語対応
  | 'reasoning'        // 推論特化
  | 'fast'             // 高速応答
  | 'local'            // ローカル実行
  | 'structured-output' // Structured Outputs対応
  | string;            // カスタム能力
```

### DriverProvider

利用可能なプロバイダー。

```typescript
type DriverProvider =
  | 'openai'
  | 'anthropic'
  | 'vertexai'
  | 'ollama'
  | 'mlx'
  | 'vllm'
  | 'test'
  | 'echo'
  | string;  // カスタムプロバイダー
```

## 推論キャンセル（AbortSignal）

`QueryOptions.signal` で進行中の推論をキャンセルします。未対応ドライバーはこのオプションを無視します。

### 契約

| 条件 | 振る舞い |
|---|---|
| 呼び出し時点で `signal.aborted` | 推論を開始しない。`result` は reject せず `finishReason: 'error'` で resolve |
| ストリーム消費中に `abort()` | バックエンドの推論を止め、`stream` を終了させる |
| キャンセル判定 | `finishReason === 'error'` かつ `signal.aborted`（呼び出し側がキャンセルとエラーを区別） |
| 部分応答 | キャンセル前に yield されたテキストは `result.content` に保持 |

### ドライバー対応状況

| ドライバー | `signal` 対応 |
|---|---|
| MlxDriver | ✅（Python 子プロセス連携） |
| その他 | 未実装（無視） |

### 使用例

```typescript
const controller = new AbortController();

const { stream, result } = await driver.streamQuery(prompt, {
  signal: controller.signal,
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
  if (shouldCancel) controller.abort();
}

const final = await result;
if (controller.signal.aborted) {
  // キャンセル（Pi 連携では stopReason: "aborted" に変換）
} else if (final.finishReason === 'error') {
  // 推論エラー
}
```

### MLX ドライバーの実装概要

TS 側が `{"method":"cancel"}\n` を Python 子プロセスの stdin に送り、Python は `stream_generate` の各チャンク前に `poll_cancel()` で非ブロッキング検知してループを抜けます。同時に Node 側の `Readable` を `destroy()` し、stdout をドレインして次リクエストがキュー詰まりしないようにします。詳細は [プロンプトキャッシュ設計](./CACHE_DESIGN.md#queryresultusage-との関係) および `packages/driver/src/mlx-ml/python/handlers/cancel.py` を参照。

## トークン使用量（usage）

`QueryResult.usage` はプロバイダ報告のトークン数を正規化したオブジェクトです。

| フィールド | 意味 |
|---|---|
| `promptTokens` | プロンプト側トークン総数（キャッシュ分を差し引く前の生値） |
| `completionTokens` | 今回の生成トークン数 |
| `totalTokens` | 少なくとも `promptTokens + completionTokens` と整合 |
| `cacheReadTokens` | 今回リクエストでキャッシュから読んだトークン数（任意） |
| `cacheWriteTokens` | 今回リクエストでキャッシュに新規書き込みしたトークン数（任意） |

driver は `promptTokens` を「非キャッシュ入力」に分解しません（`promptTokens - cacheRead - cacheWrite` のような計算は行いません）。

### ドライバー対応状況

| ドライバー | `usage` 基本3フィールド | `cacheReadTokens` / `cacheWriteTokens` |
|---|---|---|
| OpenAI / Anthropic / VertexAI / GoogleGenAI | ✅ | 未対応（省略） |
| MlxDriver | ✅ | ✅（KV キャッシュ利用時） |
| その他 | 状況により異なる | 未対応 |

MLX では Python 側の `prompt_tokens` / `generation_tokens` をマッピングし、`cacheReadTokens` は KV ヒット分、`cacheWriteTokens` は同一クエリ内の `prepare()` による新規 prefill 分を報告します。

## 共通ユーティリティ（query-utils）

`@modular-prompt/driver` が提供するヘルパー。カスタムドライバーやアダプタ実装で利用できます。

```typescript
import {
  buildQueryUsage,
  createAbortedStreamResult,
  isAborted,
  watchAbortSignal,
} from '@modular-prompt/driver';
```

| 関数 | 用途 |
|---|---|
| `buildQueryUsage(counts)` | 生トークン数から `QueryResult.usage` を組み立て（全ゼロなら `undefined`） |
| `createAbortedStreamResult(extras?)` | 即時 abort 用の空 `StreamResult`（`result` は resolve） |
| `isAborted(signal?)` | `signal?.aborted ?? false` |
| `watchAbortSignal(signal, onAbort)` | abort リスナー登録。既に aborted なら即 `onAbort` を呼ぶ |

## エラーハンドリング

すべてのドライバーは統一されたエラーハンドリングを提供：

```typescript
const result = await driver.query(prompt);

if (result.finishReason === 'error') {
  // エラーまたはキャンセル — signal.aborted で区別
  if (options?.signal?.aborted) {
    console.log('Query was cancelled');
  } else if (result.errors) {
    for (const entry of result.errors) {
      console.error(`[${entry.prefix}] ${entry.message}`);
    }
  }
} else if (result.finishReason === 'length') {
  // トークン数制限により切り詰め
  console.warn('Response was truncated');
} else if (result.finishReason === 'stop') {
  // 正常終了
}

// logEntries で全レベルのログを確認可能
if (result.logEntries) {
  console.log(`Query produced ${result.logEntries.length} log entries`);
}
```

### ドライバー実装者向けログ規約

ドライバー実装では `QueryLogger` を使用してクエリスコープのログを記録する。`console.error` / `console.warn` の直接使用は禁止。

```typescript
import { QueryLogger } from '../query-logger.js';

class MyDriver implements AIDriver {
  private queryLogger = new QueryLogger('MyDriver');

  async streamQuery(prompt, options) {
    this.queryLogger.mark();  // 各クエリの先頭で呼ぶ
    try {
      // ... API呼び出し
      const result = { content, finishReason, usage };
      return { stream, result: Promise.resolve({ ...result, ...this.queryLogger.collect() }) };
    } catch (error) {
      this.queryLogger.log.error('Query error:', error instanceof Error ? error.message : String(error));
      return {
        stream: (async function* () {})(),
        result: Promise.resolve({ content: '', finishReason: 'error', ...this.queryLogger.collect() })
      };
    }
  }
}
```

**prefix 命名規則**: ドライバー名を使用（`OpenAI`, `Anthropic`, `VertexAI`, `GoogleGenAI`, `MLX`, `vLLM`）。詳細は [UTILITIES.md](./UTILITIES.md) の Logger セクションを参照。

## 関連ドキュメント

- [packages/driver/README.md](../packages/driver/README.md) - 詳細な使用方法とカスタムドライバーの実装
- [Structured Outputs仕様](./STRUCTURED_OUTPUTS.md) - 構造化出力の詳細
- [AIService完全ガイド](./AI_SERVICE_GUIDE.md) - 動的ドライバー選択
- [テスト用ドライバーガイド](./TEST_DRIVERS.md) - TestDriver/EchoDriverの使い方
