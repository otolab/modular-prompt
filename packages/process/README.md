# @modular-prompt/process

プロンプトモジュールとワークフローを提供するパッケージ。

## インストール

```bash
npm install @modular-prompt/process
```

## ワークフロー

すべてのワークフロー関数は第1引数として `DriverInput` 型（`AIDriver` または `DriverSet`）を受け入れます。これにより、単一のドライバーまたは役割別の複数ドライバーを柔軟に指定できます。

### 基本ワークフロー

- **`defaultProcess`** - 最小のワークフロー（compile + driver.query）
  - すべてのプロセスの基本形
  - モジュールをコンパイルしてドライバーで実行するだけのシンプルな処理

### チャンク処理ワークフロー

- **`streamProcess`** - ステートを保持しながらチャンクを逐次処理
  - 内部で `streamProcessing` モジュールを自動的にマージ
- **`concatProcess`** - 各チャンクを独立して処理し、結果を結合
  - 内部で `concatProcessing` モジュールを自動的にマージ

### エージェント型ワークフロー

- **`agenticProcess`** - 自律的な複数ステップ処理（計画→実行→統合）
- **`agentProcess`** - シンプルな計画→実行→統合ワークフロー

## モジュール

- **`streamProcessing`** - チャンク単位の逐次処理と状態管理
- **`withMaterials`** - 資料をプロンプトに含める
- **`dialogueモジュール群`** - 対話処理用モジュール
- **`summarizeモジュール群`** - 要約処理用モジュール
- **`agenticモジュール群`** - エージェント型ワークフロー用モジュール

## 使用例

### 基本ワークフロー

```typescript
import { defaultProcess } from '@modular-prompt/process';
import type { PromptModule } from '@modular-prompt/core';
import { OpenAIDriver } from '@modular-prompt/driver';

const driver = new OpenAIDriver({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o'
});

const module: PromptModule<{ query: string }> = {
  objective: ['ユーザーの質問に回答する'],
  instructions: [
    (ctx) => `質問: ${ctx.query}`,
  ],
};

const result = await defaultProcess(
  driver,
  module,
  { query: 'TypeScriptとは何ですか？' },
  { queryOptions: { temperature: 0.7 } }
);

console.log(result.output);  // AIの応答
console.log(result.consumedUsage);  // 実際に消費したトークン数（コスト把握用）
console.log(result.responseUsage);  // 最終応答のトークン数（メッセージサイズ目安）
```

### チャンク処理

```typescript
import { streamProcess } from '@modular-prompt/process';
import { TestDriver } from '@modular-prompt/driver';

const driver = new TestDriver(['response1', 'response2']);

// streamProcessingモジュールは自動的にマージされるため、
// ユーザーモジュールのみを渡すことができます
const userModule = {
  objective: ['チャンクを順次処理して要約を作成'],
  instructions: ['各チャンクの内容を前の状態と統合']
};

const result = await streamProcess(
  driver,
  userModule,  // streamProcessingは内部で自動マージ
  {
    chunks: [{ content: 'text1' }, { content: 'text2' }],
    state: { content: '', usage: 0 }
  },
  { tokenLimit: 1000 }
);
```

### エージェント型ワークフロー

```typescript
import { agenticProcess } from '@modular-prompt/process';
import { AnthropicDriver } from '@modular-prompt/driver';

const driver = new AnthropicDriver({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022'
});

// ユーザー定義のプロンプトモジュール
const userModule = {
  objective: ['今日の夕飯の献立を決定する'],
  instructions: [
    '- 冷蔵庫の材料から作れる主菜候補を検討する',
    '- 過去の献立と比較し、似たものが続かないようにする',
    '- 選んだ主菜に合う副菜を提案する',
    '- 不足している材料があれば買い出しリストを作成する'
  ]
};

// コンテキスト（初期データ）
const context = {
  objective: '今日の夕飯の献立を決定する',
  inputs: {
    refrigerator: {
      proteins: ['鶏もも肉 300g', '豚バラ肉 200g', '卵 6個'],
      vegetables: ['キャベツ', '人参', '玉ねぎ', 'じゃがいも']
    },
    pastMeals: [
      { date: '昨日', mainDish: 'カレーライス' },
      { date: '一昨日', mainDish: '生姜焼き' }
    ]
  }
};

// ワークフロー実行（planning → execution tasks → output）
const result = await agenticProcess(driver, userModule, context, {
  maxTasks: 5,  // 最大5タスクまで
});

console.log(result.output);  // 最終的な献立提案
console.log(result.metadata); // { planTasks, executedTasks, toolCallsUsed, finishReason, iterations }
console.log(result.consumedUsage); // 全タスク実行の合計usage（リトライ含む）
console.log(result.responseUsage); // 最終タスクのusage
```

### 外部ツールの使用

```typescript
import { agenticProcess } from '@modular-prompt/process';
import type { ToolSpec } from '@modular-prompt/process';

// 外部ツールの定義（definition + handler）
const tools: ToolSpec[] = [
  {
    definition: {
      name: 'fetchWeather',
      description: 'Get weather information for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' }
        },
        required: ['location'],
      },
    },
    handler: async (params) => {
      const response = await fetch(`https://api.weather.com/${params.location}`);
      return JSON.stringify(await response.json());
    },
  },
];

const result = await agenticProcess(driver, userModule, context, {
  tools,       // 外部ツールを渡す
  maxTasks: 5,
});

// 外部ツール呼び出しが発生するとワークフローは中断し、
// pendingToolCalls として返却される
if (result.metadata.finishReason === 'tool_calls') {
  // 呼び出し元でツールを実行し、結果を渡して再開する
  console.log(result.context.executionLog);
}
```

## WorkflowResult型

すべてのワークフロー関数は以下の型を返します：

```typescript
interface WorkflowResult<TContext> {
  output: string;              // 最終的な出力テキスト
  context: TContext;           // 更新されたContext（継続可能な状態）
  
  // Usage情報
  consumedUsage?: {            // 全query()呼び出しの合計（リトライ含む）= 実コスト
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  responseUsage?: {            // 最終応答のusage = メッセージサイズの目安
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  
  // ログ情報
  logEntries?: LogEntry[];     // ワークフロー実行中の全ログエントリ
  errors?: LogEntry[];         // エラーレベルのログエントリ
  
  // その他のメタデータ
  metadata?: {
    iterations?: number;       // イテレーション数（streamProcessなど）
    [key: string]: any;        // ワークフロー固有のメタデータ
  };
}
```

詳細は [プロセスモジュールガイド](../docs/PROCESS_MODULE_GUIDE.md) を参照してください。

## 開発者向けドキュメント

ワークフロー実装者向けのドキュメント:

- **[ワークフローログ規約](./docs/WORKFLOW_LOG_CONVENTIONS.md)** - Logger 使用規約とログ出力の標準化

## ライセンス

MIT
