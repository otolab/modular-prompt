---
name: driver-usage
description: modular-promptのドライバー（AIDriver）の使い方ガイド。各ドライバーの初期化、Config、query/streamQuery、ツール定義、構造化出力、AIServiceによるモデル選択を参照する。
---

# ドライバー使い方ガイド

## ドライバーとは

`@modular-prompt/driver` は、コンパイル済みプロンプト（CompiledPrompt）をAIモデルに送信し、結果を受け取るための統一インターフェースを提供する。各AIサービスのAPI差異をドライバー層が吸収するため、プロンプト側のコードを変えずにモデルを切り替えられる。

### 基本的な使い方

```typescript
import { compile } from '@modular-prompt/core';
import { OpenAIDriver } from '@modular-prompt/driver';

const driver = new OpenAIDriver({ model: 'gpt-4o' });
const compiled = compile(myModule, context);

// 通常クエリ
const result = await driver.query(compiled);
console.log(result.content);

// ストリーミング
const { stream, result: resultPromise } = await driver.streamQuery(compiled);
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
const finalResult = await resultPromise;

await driver.close();
```

## AIDriver インターフェース

全ドライバーが実装する共通インターフェース:

```typescript
interface AIDriver {
  query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult>;
  streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult>;
  close(): Promise<void>;
}
```

### QueryOptions

```typescript
interface QueryOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
}
```

### QueryResult

```typescript
interface QueryResult {
  content: string;               // テキストレスポンス
  structuredOutput?: unknown;    // 構造化出力（schema指定時）
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolCalls?: ToolCall[];        // ツール呼び出し
  finishReason?: FinishReason;   // 'stop' | 'length' | 'error' | 'tool_calls'
}
```

### StreamResult

```typescript
interface StreamResult {
  stream: AsyncIterable<string>;  // テキストチャンクのストリーム
  result: Promise<QueryResult>;   // 最終結果（ストリーム完了後に解決）
}
```

## 各ドライバーのConfig

### OpenAIDriver

```typescript
import { OpenAIDriver } from '@modular-prompt/driver';

const driver = new OpenAIDriver({
  apiKey: process.env.OPENAI_API_KEY,  // 環境変数で代替可
  model: 'gpt-4o-mini',               // デフォルト: 'gpt-4o-mini'
  baseURL: 'https://...',             // カスタムエンドポイント（オプション）
  organization: '...',                // Organization ID（オプション）
  defaultOptions: {
    temperature: 0.7,
    maxTokens: 2000,
    frequencyPenalty: 0,               // OpenAI固有
    presencePenalty: 0,                // OpenAI固有
    stop: ['---'],                     // 停止シーケンス
    responseFormat: { type: 'json_object' },
    seed: 42
  }
});
```

### AnthropicDriver

```typescript
import { AnthropicDriver } from '@modular-prompt/driver';

const driver = new AnthropicDriver({
  apiKey: process.env.ANTHROPIC_API_KEY,  // 環境変数で代替可
  model: 'claude-3-5-sonnet-20241022',    // デフォルト
  defaultOptions: {
    maxTokens: 4096,
    temperature: 0.7,
    topK: 40,                              // Anthropic固有
    stopSequences: ['---']
  }
});
```

### VertexAIDriver

```typescript
import { VertexAIDriver } from '@modular-prompt/driver';

const driver = new VertexAIDriver({
  project: 'my-gcp-project',     // 環境変数 GOOGLE_CLOUD_PROJECT で代替可
  location: 'us-central1',       // デフォルト: 'us-central1'
  model: 'gemini-2.0-flash-001', // デフォルト
  temperature: 0.05,
  defaultOptions: {
    maxTokens: 1000,
    topP: 0.95,
    topK: 40
  }
});
```

Google Cloud認証（ADCまたはサービスアカウント）が必要。

### GoogleGenAIDriver

```typescript
import { GoogleGenAIDriver } from '@modular-prompt/driver';

const driver = new GoogleGenAIDriver({
  apiKey: process.env.GOOGLE_GENAI_API_KEY,  // 必須
  model: 'gemini-2.0-flash-exp',
  temperature: 0.7,
  defaultOptions: {
    maxTokens: 2048,
    topP: 0.95,
    topK: 40,
    thinkingConfig: { thinkingLevel: 'HIGH' }  // GoogleGenAI固有
  }
});
```

APIキーのみで利用可能（Google AI Studioから取得）。

### OllamaDriver

```typescript
import { OllamaDriver } from '@modular-prompt/driver';

const driver = new OllamaDriver({
  baseURL: 'http://localhost:11434/v1',  // デフォルト
  model: 'llama3.2'                      // デフォルト
});
```

OpenAI互換APIでローカルLLMにアクセス。

### MlxDriver

```typescript
import { MlxDriver } from '@modular-prompt/driver';

const driver = new MlxDriver({
  model: 'mlx-community/Llama-3.2-3B-Instruct-4bit',  // 必須
  defaultOptions: {
    temperature: 0.7,
    maxTokens: 500,
    repetitionPenalty: 1.1,     // MLX固有
    repetitionContextSize: 20   // MLX固有
  }
});

// 使用後は必ずclose()（Pythonサブプロセス終了）
await driver.close();
```

Apple Silicon専用。Python 3.11以上が必要。

### テスト・デバッグ用ドライバー

```typescript
import { TestDriver, EchoDriver } from '@modular-prompt/driver';

// TestDriver: モックレスポンス
const testDriver = new TestDriver({
  responses: ['応答1', '応答2'],    // キューから順に返す
  delay: 100                        // レイテンシのシミュレート（ms）
});

// レスポンスプロバイダ関数
const testDriver2 = new TestDriver({
  responses: (prompt, options) => {
    if (prompt.metadata?.outputSchema) {
      return JSON.stringify({ result: 'ok' });
    }
    return 'テキスト応答';
  }
});

// EchoDriver: フォーマット済みプロンプトをそのまま返す（AI呼び出しなし）
const echoDriver = new EchoDriver({
  format: 'debug',        // 'text' | 'messages' | 'raw' | 'both' | 'debug'
  includeMetadata: true
});
```

## ツール定義（Function Calling）

### ToolDefinition

```typescript
const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: '指定都市の天気を取得',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '都市名' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
      },
      required: ['city']
    }
  }
];
```

### ToolChoice

```typescript
type ToolChoice =
  | 'auto'             // モデルが自動判断（デフォルト）
  | 'none'             // ツール使用禁止
  | 'required'         // 必ず1つ以上のツールを使用
  | { name: string };  // 特定ツールを強制
```

### ツール呼び出しの処理

```typescript
const result = await driver.query(compiled, { tools, toolChoice: 'auto' });

if (result.toolCalls) {
  for (const call of result.toolCalls) {
    console.log(call.name);       // 関数名
    console.log(call.id);         // 呼び出しID
    console.log(call.arguments);  // 引数オブジェクト
  }
}
```

対応ドライバー: OpenAI、Anthropic、VertexAI、GoogleGenAI

### ツール結果の返し方（会話ループ）

ツール呼び出し結果をモデルに返す会話ループは利用者側で実装する。`QueryOptions.messages` にツール結果を含めて再クエリする。

```typescript
const result1 = await driver.query(compiled, { tools, toolChoice: 'auto' });

if (result1.toolCalls) {
  // ツールを実行して結果を収集
  const toolResults = await Promise.all(
    result1.toolCalls.map(async (tc) => {
      const data = await executeFunction(tc.name, tc.arguments);
      return {
        role: 'tool' as const,
        toolCallId: tc.id,
        name: tc.name,
        kind: 'data' as const,   // 'text' | 'data' | 'error'
        value: data
      };
    })
  );

  // ツール結果を含めて再クエリ
  const result2 = await driver.query(compiled, {
    tools,
    messages: [
      { role: 'assistant', content: result1.content, toolCalls: result1.toolCalls },
      ...toolResults
    ]
  });
}
```

### ToolResultKind

ツール結果の種類を示すタグ:
- `'text'` - プレーンテキスト
- `'data'` - 構造化データ（オブジェクト等）
- `'error'` - エラー情報

## 構造化出力

プロンプトの `schema` セクションに JSONElement を定義すると、ドライバーが自動的に構造化出力を処理する。

```typescript
const myModule: PromptModule = {
  objective: ['ユーザー情報を抽出する'],
  schema: [{
    type: 'json',
    content: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' }
      },
      required: ['name', 'age']
    }
  }]
};

const result = await driver.query(compile(myModule, ctx));
const data = result.structuredOutput as { name: string; age: number };
```

ドライバーごとの実装方式:
- **ネイティブサポート**: OpenAI（`response_format`）、VertexAI / GoogleGenAI（`responseSchema`）
- **JSON抽出型**: Anthropic、MLX（プロンプト指示 + レスポンスからJSON抽出）

## AIService（モデル選択）

複数モデルを登録し、能力（capabilities）ベースで最適なモデルを自動選択する。

### 設定

```typescript
import { AIService } from '@modular-prompt/driver';

const service = new AIService({
  models: [
    {
      model: 'gpt-4o',
      provider: 'openai',
      capabilities: ['streaming', 'japanese', 'tools', 'structured'],
      priority: 10,
      cost: { input: 0.01, output: 0.03 }
    },
    {
      model: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      capabilities: ['streaming', 'japanese', 'tools', 'reasoning'],
      priority: 8
    }
  ],
  drivers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY }
  },
  defaultOptions: {
    temperature: 0.7,
    maxTokens: 2048
  }
});
```

### ModelSpec

```typescript
interface ModelSpec {
  model: string;
  provider: DriverProvider;
  capabilities: DriverCapability[];
  priority?: number;              // 高いほど優先
  disabled?: boolean;             // 無効化フラグ
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  tokensPerMinute?: number;       // TPM制限
  requestsPerMinute?: number;     // RPM制限
  cost?: { input: number; output: number };
  metadata?: Record<string, unknown>;
}
```

### DriverCapability（能力フラグ）

| 能力 | 説明 |
|------|------|
| `streaming` | ストリーミング応答 |
| `local` | ローカル実行 |
| `fast` | 高速応答 |
| `large-context` | 大規模コンテキスト |
| `multilingual` | 多言語対応 |
| `japanese` | 日本語特化 |
| `coding` | コーディング特化 |
| `reasoning` | 推論・思考特化 |
| `chat` | チャット特化 |
| `tools` | ツール使用 |
| `vision` | 画像認識 |
| `audio` | 音声処理 |
| `structured` | 構造化出力 |
| `json` | JSON出力 |
| `function-calling` | 関数呼び出し |

### モデル選択

```typescript
// 能力ベースでドライバーを自動作成
const driver = await service.createDriverFromCapabilities(
  ['japanese', 'streaming'],
  {
    preferLocal: true,           // ローカル優先
    preferProvider: 'anthropic', // 特定プロバイダー優先
    excludeProviders: ['openai'],
    preferFast: true,            // 高速優先
    lenient: true                // 条件緩和モード（条件を後ろから減らして再検索）
  }
);
```
