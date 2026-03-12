# はじめに

## インストール

```bash
npm install @modular-prompt/core @modular-prompt/driver @modular-prompt/process
```

## 環境設定

### APIキーの設定

使用するAIプロバイダーのAPIキーを環境変数に設定：

```bash
# OpenAI
export OPENAI_API_KEY=sk-...

# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Google Vertex AI
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
```

### AIServiceの設定

複数のモデルを登録し、タスクに応じて自動選択：

```typescript
import { AIService } from '@modular-prompt/driver';

const aiService = new AIService({
  models: [
    {
      model: 'gpt-4o-mini',
      provider: 'openai',
      capabilities: ['streaming', 'japanese', 'fast'],
      priority: 10
    },
    {
      model: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      capabilities: ['streaming', 'japanese', 'reasoning'],
      priority: 20
    }
  ],
  drivers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY }
  }
});
```

## プロセスモジュールを使う

### 基本的なワークフロー

最もシンプルなワークフロー `defaultProcess` を使って、プロンプトモジュールをコンパイル・実行：

```typescript
import { defaultProcess } from '@modular-prompt/process';
import type { PromptModule } from '@modular-prompt/core';

// プロンプトモジュールを定義
const qaModule: PromptModule<{ query: string }> = {
  objective: ['ユーザーの質問に回答する'],
  instructions: [
    '- 正確で分かりやすい説明を心がける',
    (ctx) => `質問: ${ctx.query}`,
  ],
};

async function answerQuestion(question: string) {
  // ドライバーを取得
  const driver = await aiService.createDriverFromCapabilities(['japanese', 'fast']);
  if (!driver) {
    throw new Error('No suitable driver found');
  }

  // defaultProcessで実行
  const result = await defaultProcess(
    driver,
    qaModule,
    { query: question },
    { queryOptions: { temperature: 0.7, maxTokens: 2048 } }
  );

  return result.output;
}

// 使用例
const answer = await answerQuestion('TypeScriptとは何ですか？');
console.log('回答:', answer);
```

### 大量の文章を要約する

streamProcessワークフローを使って、長い文章を分割して要約：

```typescript
import { streamProcess } from '@modular-prompt/process';

// 要約用のユーザーモジュール
// streamProcessingモジュールは内部で自動的にマージされます
const summaryModule = {
  objective: ['文章を段階的に要約する'],
  instructions: [
    '各チャンクの重要なポイントを抽出',
    '前の状態と統合して次の状態を生成'
  ]
};

async function summarizeLongText(text: string) {
  // ドライバーを取得
  const driver = await aiService.createDriverFromCapabilities(['japanese', 'fast']);
  if (!driver) {
    throw new Error('No suitable driver found');
  }

  // コンテキストを準備
  const context = {
    sourceText: text,
    chunks: [],  // streamProcessが自動分割
    currentState: '',
    range: { start: 0, end: 0 }
  };

  // streamProcessで実行
  // streamProcessingモジュールは自動的にマージされます
  const result = await streamProcess(
    driver,
    summaryModule,
    context,
    {
      tokenLimit: 4000,  // チャンク分割の目安
      maxChunk: 10       // 最大チャンク数
    }
  );

  return result.finalState;
}

// 使用例
const summary = await summarizeLongText(`
  長い文章がここに入る...
  複数の段落があり...
  様々なトピックを含む...
`);

console.log('要約:', summary);
```

### 複数のアイテムを処理して結合する

concatProcessワークフローを使って、複数のアイテムを個別に処理し、結果を結合：

```typescript
import { concatProcess } from '@modular-prompt/process';

// 各アイテムを処理するユーザーモジュール
// concatProcessingモジュールは内部で自動的にマージされます
const analysisModule = {
  objective: ['各質問に回答する'],
  instructions: ['簡潔に回答', '日本語で記述']
};

async function answerMultipleQuestions(questions: string[]) {
  // ドライバーを取得
  const driver = await aiService.createDriverFromCapabilities(['japanese']);
  if (!driver) {
    throw new Error('No suitable driver found');
  }

  // コンテキストを準備
  const context = {
    chunks: questions.map(q => ({ content: q })),
    results: []
  };

  // concatProcessで実行
  // concatProcessingモジュールは自動的にマージされます
  const result = await concatProcess(
    driver,
    analysisModule,
    context,
    {
      batchSize: 2,      // 一度に処理するアイテム数
      separator: '\n\n', // 結果を結合する際の区切り文字
      parallel: false    // 並列処理の有効化
    }
  );

  return result.output;
}

// 使用例
const answers = await answerMultipleQuestions([
  'TypeScriptとは何ですか？',
  'JavaScriptとの違いは？',
  'どのような場面で使われますか？'
]);

console.log('回答:\n', answers);
```

### 資料を使った処理

```typescript
import { withMaterials } from '@modular-prompt/process';

// モジュールを定義
const analysisModule = {
  objective: ['資料を分析して要約を作成する'],
  instructions: ['重要なポイントを抽出', '簡潔にまとめる']
};

// 資料管理機能を追加
const module = merge(analysisModule, withMaterials);

// ワークフロー関数
async function analyzeMaterials(documents: string[]) {
  // コンテキストを作成
  const context = createContext(module);

  // 資料を追加
  for (const [index, doc] of documents.entries()) {
    context.addMaterial({
      id: `doc-${index}`,
      title: `Document ${index + 1}`,
      content: doc
    });
  }

  // コンパイルと実行
  const compiled = compile(module, context);
  const driver = await aiService.createDriverFromCapabilities(['japanese', 'fast']);

  if (!driver) {
    throw new Error('No suitable driver found');
  }

  const result = await driver.query(compiled);
  return result.content;
}

// 使用例
const summary = await analyzeMaterials([
  '資料1の内容...',
  '資料2の内容...',
  '資料3の内容...'
]);

console.log(summary);
```

### ストリーミング処理

```typescript
import { streamProcess } from '@modular-prompt/process';

// ストリーミングモジュール
const chatModule = {
  objective: ['ユーザーと対話する'],
  instructions: ['親切に回答', '日本語で応答'],
  // 会話履歴をMessageElement形式に整形
  messages: [(ctx) => ctx.conversationHistory.map(msg => ({
    type: 'message' as const,
    role: msg.role,
    content: msg.content
  }))]
};

// ストリーミング処理を実行
async function chat(userMessage: string, history: Array<{role: string, content: string}> = []) {
  const context = createContext(chatModule);
  context.conversationHistory = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  const compiled = compile(chatModule, context);
  const driver = await aiService.createDriverFromCapabilities(['streaming', 'japanese']);

  if (!driver) {
    throw new Error('No suitable driver found');
  }

  const { stream, result } = await driver.streamQuery(compiled);

  // ストリームを処理
  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }

  // 最終結果を取得
  const finalResult = await result;
  return finalResult.content;
}

// 使用例
const response = await chat('TypeScriptについて教えて');
```

### データチャンクの処理

大量のデータを分割して処理：

```typescript
import { withChunks } from '@modular-prompt/process';

const processModule = {
  objective: ['データを分析する'],
  instructions: ['各チャンクを処理', '結果を統合']
};

const module = merge(processModule, withChunks);

async function processLargeData(data: string[]) {
  const context = createContext(module);

  // データをチャンクとして追加
  for (const [index, item] of data.entries()) {
    context.addChunk({
      content: item,
      partOf: 'dataset',
      index,
      total: data.length
    });
  }

  const compiled = compile(module, context);
  const driver = await aiService.createDriverFromCapabilities(['fast']);

  if (!driver) {
    throw new Error('No suitable driver found');
  }

  const result = await driver.query(compiled);
  return result.content;
}
```

## 構造化出力

JSONスキーマを使って型安全な出力を取得：

```typescript
const extractionModule = {
  objective: ['テキストから情報を抽出'],
  inputs: [(ctx) => ctx.text],
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] }
        },
        required: ['summary', 'keywords', 'sentiment']
      }
    }
  ]
};

async function extractInfo(text: string) {
  const context = createContext(extractionModule);
  context.text = text;

  const compiled = compile(extractionModule, context);
  const driver = await aiService.createDriverFromCapabilities(['structured-output']);

  if (!driver) {
    throw new Error('No suitable driver found');
  }

  const result = await driver.query(compiled);

  if (result.structuredOutput) {
    const data = result.structuredOutput as {
      summary: string;
      keywords: string[];
      sentiment: 'positive' | 'negative' | 'neutral';
    };

    console.log('Summary:', data.summary);
    console.log('Keywords:', data.keywords);
    console.log('Sentiment:', data.sentiment);
  }
}
```

## ローカルモデルの使用

```typescript
import { MlxDriver } from '@modular-prompt/driver';

// AIServiceにローカルモデルを追加
const aiService = new AIService({
  models: [
    {
      model: 'mlx-community/gemma-2-2b-it-4bit',
      provider: 'mlx',
      capabilities: ['local', 'fast', 'japanese'],
      priority: 30  // ローカル優先の場合は低い値に
    },
    // ... クラウドモデル
  ],
  drivers: {
    mlx: {}  // MLXは設定不要
  }
});

// ローカル優先で選択
const driver = await aiService.createDriverFromCapabilities(
  ['fast'],
  { preferLocal: true }
);
```

## 次のステップ

### 仕様を理解する

- [プロンプトモジュール仕様](./PROMPT_MODULE_SPEC.md) - プロンプトモジュールの完全な仕様
- [Driver API](./DRIVER_API.md) - ドライバーインターフェースの詳細
- [AIService完全ガイド](./AI_SERVICE_GUIDE.md) - 動的ドライバー選択の詳細

### プロセスモジュールを深く知る

- [プロセスモジュールガイド](./PROCESS_MODULE_GUIDE.md) - プロセスモジュールの実装ガイドライン

### テストとデバッグ

- [テスト用ドライバー](./TEST_DRIVERS.md) - TestDriver/EchoDriverの使い方
