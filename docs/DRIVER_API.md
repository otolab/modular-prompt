# Driver APIリファレンス

`@modular-prompt/driver`パッケージのAPIリファレンス。

## 目次

- [インターフェース](#インターフェース)
- [利用可能なドライバー](#利用可能なドライバー)
- [型定義](#型定義)
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

ストリーミングレスポンスを生成。

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
| VertexAIDriver | Google Cloud | ✅ ネイティブ | Gemini (Vertex AI) |
| GoogleGenAIDriver | Google AI | ✅ ネイティブ | Gemini (API Key) |

### ローカル実行

| ドライバー | プロバイダー | Structured Outputs | 用途 |
|----------|------------|-------------------|------|
| OllamaDriver | Ollama | ✅ ネイティブ（継承） | ローカルLLM（OpenAI互換） |
| MlxDriver | MLX | ✅ JSON抽出 | Apple Silicon最適化 |

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
  content: string;
  name?: string;
}
```

### QueryOptions

クエリ実行時のオプション。

```typescript
interface QueryOptions {
  temperature?: number;   // 生成のランダム性 (0-2)
  maxTokens?: number;     // 最大トークン数
  topP?: number;          // トップPサンプリング
  stream?: boolean;       // ストリーミング有効化
}
```

### QueryResult

クエリ結果の型。

```typescript
interface QueryResult {
  content: string;                     // テキストレスポンス
  structuredOutput?: unknown;          // 構造化出力（スキーマ指定時）
  finishReason?: 'stop' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

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
  | 'test'
  | 'echo'
  | string;  // カスタムプロバイダー
```

## エラーハンドリング

すべてのドライバーは統一されたエラーハンドリングを提供：

```typescript
const result = await driver.query(prompt);

if (result.finishReason === 'error') {
  // エラー発生
  console.error('Query failed');
} else if (result.finishReason === 'length') {
  // トークン数制限により切り詰め
  console.warn('Response was truncated');
} else if (result.finishReason === 'stop') {
  // 正常終了
  console.log('Success');
}
```

## 関連ドキュメント

- [packages/driver/README.md](../packages/driver/README.md) - 詳細な使用方法とカスタムドライバーの実装
- [Structured Outputs仕様](./STRUCTURED_OUTPUTS.md) - 構造化出力の詳細
- [AIService完全ガイド](./AI_SERVICE_GUIDE.md) - 動的ドライバー選択
- [テスト用ドライバーガイド](./TEST_DRIVERS.md) - TestDriver/EchoDriverの使い方
