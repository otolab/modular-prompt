# @modular-prompt/process

プロンプトモジュールとワークフローを提供するパッケージ。

## インストール

```bash
npm install @modular-prompt/process
```

## ワークフロー

### 基本ワークフロー

- **`defaultProcess`** - 最小のワークフロー（compile + driver.query）
  - すべてのプロセスの基本形
  - モジュールをコンパイルしてドライバーで実行するだけのシンプルな処理

### チャンク処理ワークフロー

- **`streamProcess`** - ステートを保持しながらチャンクを逐次処理
- **`concatProcess`** - 各チャンクを独立して処理し、結果を結合

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
```

### チャンク処理

```typescript
import { streamProcess } from '@modular-prompt/process';
import { streamProcessing } from '@modular-prompt/process';
import { TestDriver } from '@modular-prompt/driver';

const driver = new TestDriver(['response1', 'response2']);

const result = await streamProcess(
  driver,
  streamProcessing,
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

// ワークフロー実行（計画→実行→統合）
const result = await agenticProcess(driver, userModule, context, {
  maxSteps: 5  // 最大5ステップまで
});

console.log(result.output);  // 最終的な献立提案
console.log(result.metadata); // { planSteps: 5, executedSteps: 5, actionsUsed: 0 }
```

### 簡易エージェントワークフロー

```typescript
import { agentProcess } from '@modular-prompt/process';
import { TestDriver } from '@modular-prompt/driver';

const driver = new TestDriver();

const userModule = {
  objective: ['週末旅行プランを提案する'],
  instructions: [
    '- 交通手段・宿泊先・食事プランを検討する',
    '- 入力データに応じて実行計画を自律的に組み立てる'
  ]
};

const context = {
  objective: '週末旅行プランを提案する',
  inputs: {
    budget: '50,000円',
    city: '箱根'
  }
};

const actions = {
  lookupHotel: async (params: { city: string }) => {
    return { recommended: [`${params.city} 温泉旅館`] };
  }
};

const result = await agentProcess(driver, userModule, context, {
  maxSteps: 4,
  actions
});

console.log(result.output);
console.log(result.metadata); // { planSteps: 3, executedSteps: 3, actionsUsed: 1 }
```

### アクション（外部ツール）の使用

```typescript
import { agenticProcess } from '@modular-prompt/process';

// 外部ツール/APIの定義
const actions = {
  fetchWeather: async (params: { location: string }) => {
    const response = await fetch(`https://api.weather.com/${params.location}`);
    return response.json();
  },
  searchRecipes: async (params: { ingredients: string[] }) => {
    // レシピ検索APIを呼び出し
    return { recipes: [...] };
  }
};

const result = await agenticProcess(driver, userModule, context, {
  maxSteps: 5,
  actions  // アクションを渡す
});

// AIが計画フェーズで必要なアクションを判断し、実行フェーズで自動的に呼び出す
```


## ライセンス

MIT
