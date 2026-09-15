# Moduler Prompt

プロンプトを再利用可能なモジュールとして構築・管理するTypeScriptフレームワーク。

## なぜModuler Promptを使うのか

複雑な生成AIタスクにおいて、プロンプトエンジニアリングは重要だが管理が困難である。本フレームワークは以下の課題を解決する：

- **再利用性** - 一度作成したプロンプトモジュールを異なるコンテキストで再利用
- **保守性** - プロンプトを構造化し、変更や拡張を容易に
- **型安全性** - TypeScriptの型システムでランタイムエラーを防止
- **柔軟性** - 実行時にコンテキストに応じてプロンプトを動的生成

## 主な特徴

- **モジュール化** - プロンプトを再利用可能なモジュールとして構築
- **動的生成** - 実行時のコンテキストに基づいたプロンプト生成
- **マルチモデル対応** - OpenAI、Anthropic、Google、ローカルLLMに対応
- **構造化出力** - JSONスキーマに基づく構造化データの取得（ベストエフォート）
- **ストリーム処理** - 大規模データの効率的な処理
- **型安全** - TypeScriptによる完全な型定義
- **柔軟なマージ** - モジュールの再帰的統合と順序制御

## プロジェクト構造

このプロジェクトはpnpm workspacesを使用したモノレポ構造です：

```
@modular-prompt/
├── core/         # コア機能（型定義、マージ、コンパイル）
├── driver/       # 各種AIモデルドライバ（OpenAI、Anthropic、VertexAI、MLX等）
├── utils/        # ユーティリティ（レジストリ、フォーマッター）
├── process/      # ストリーム処理とマテリアル管理
└── simple-chat/  # サンプル実装: チャットアプリケーション
```

## ドキュメント

### ユーザー向けドキュメント
- [はじめに](./docs/GETTING_STARTED.md) - インストール、環境設定、プロセスモジュールの使い方
- [コンセプトと設計思想](./docs/CONCEPTS.md) - フレームワークの理念と課題解決アプローチ
- [アーキテクチャ](./docs/ARCHITECTURE.md) - システム構成と技術詳細
- [プロンプトモジュール仕様](./docs/PROMPT_MODULE_SPEC.md) - プロンプトモジュールの完全な仕様
- [プロセスモジュールガイド](./docs/PROCESS_MODULE_GUIDE.md) - プロセスモジュールの実装ガイドライン
- [ドライバーAPI](./docs/DRIVER_API.md) - AIモデルドライバーのAPI仕様
- [ローカルモデルセットアップガイド](./docs/LOCAL_MODEL_SETUP.md) - MLX、PyTorch、Ollamaのセットアップとモデルダウンロード
- [Structured Outputs](./docs/STRUCTURED_OUTPUTS.md) - 構造化出力（JSON）の仕様と使用方法
- [テスト用ドライバー](./docs/TEST_DRIVERS.md) - TestDriverとEchoDriverの使用方法
- [ユーティリティ](./docs/UTILITIES.md) - ログシステムとその他のユーティリティ

### 開発者向けドキュメント
- [CLAUDE.md](./CLAUDE.md) - Claude Code向けのインデックス
- [ドキュメント同期ガイド](./prompts/document-code-sync.md) - ドキュメントとコードの同期管理
- [校正ガイド](./prompts/DOCUMENT_PROOFREADING_GUIDE.md) - ドキュメント校正の指針

## クイックスタート

### インストール

```bash
npm install @modular-prompt/core @modular-prompt/driver
```

### 基本的な使用例

```typescript
import { merge, compile, createContext } from '@modular-prompt/core';
import type { PromptModule, ChunkElement } from '@modular-prompt/core';

// モジュールの定義
interface AnalysisContext {
  sourceCode: string;
  language: string;
}

const analysisModule: PromptModule<AnalysisContext> = {
  createContext: () => ({
    sourceCode: '',
    language: 'javascript'
  }),
  
  objective: ['コードの品質を分析する'],
  instructions: ['静的解析を実行', 'パフォーマンス問題を特定'],
  
  chunks: [
    (context) => ({
      type: 'chunk',
      content: context.sourceCode,
      partOf: `main.${context.language}`
    } as ChunkElement)
  ],
  
  cue: ['分析結果をJSON形式で出力']
};

// 実行
const context = createContext(analysisModule);
context.sourceCode = 'const example = () => { ... }';

const compiled = compile(analysisModule, context);
// compiledは instructions, data, output のElement配列を含む
```

### AIサービスを使った動的ドライバー選択

ケイパビリティベースで最適なAIモデルを自動選択：

```typescript
import { AIService } from '@modular-prompt/driver';

// AIサービスを設定
const aiService = new AIService({
  models: [
    {
      model: 'gpt-4o-mini',
      provider: 'openai',
      capabilities: ['streaming', 'tools', 'reasoning'],
      priority: 10
    },
    {
      model: 'llama-3.3-70b',
      provider: 'mlx',
      capabilities: ['local', 'fast', 'japanese'],
      priority: 30
    }
  ],
  drivers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    mlx: {} // MLXは設定不要
  }
});

// ローカル実行を優先して高速ドライバーを選択
const driver = await aiService.createDriverFromCapabilities(
  ['fast'],
  { preferLocal: true }
);

if (driver) {
  const compiled = compile(module, context);
  const result = await driver.query(compiled);
  console.log(result.content);
}
```

### 構造化出力（Structured Outputs）

AIからの応答を構造化されたJSONとして取得：

```typescript
// モジュールのschemaセクションでJSONElementを定義
const moduleWithSchema: PromptModule = {
  ...analysisModule,
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          issues: { type: 'array', items: { type: 'string' } },
          score: { type: 'number' }
        }
      }
    }
  ]
};

// compileすると自動的にmetadata.outputSchemaが設定される
const prompt = compile(moduleWithSchema, context);

const result = await driver.query(prompt);
if (result.structuredOutput) {
  const analysis = result.structuredOutput;
  console.log('Score:', analysis.score);
  console.log('Issues:', analysis.issues);
}
```

詳細は[Structured Outputs仕様](./docs/STRUCTURED_OUTPUTS.md)を参照してください。

### テストとデバッグ

開発・テスト用のドライバーを提供：

```typescript
import { TestDriver, EchoDriver } from '@modular-prompt/driver';

// モックレスポンスでテスト
const testDriver = new TestDriver({
  responses: ['{"result": "success"}']
});

// プロンプトをエコーバックでデバッグ
const echoDriver = new EchoDriver({
  format: 'debug'
});

const result = await echoDriver.query(compiled);
console.log(JSON.parse(result.content)); // プロンプト構造を確認
```

詳細は[TEST_DRIVERS.md](./docs/TEST_DRIVERS.md)を参照。

## 開発

### セットアップ

```bash
# 依存関係のインストール
pnpm install

# ビルド
pnpm build

# テスト
pnpm test

# 開発モード
pnpm dev
```

### ワークスペースコマンド

```bash
# 特定のワークスペースでコマンドを実行
pnpm --filter @modular-prompt/core build
pnpm --filter @modular-prompt/driver test

# すべてのワークスペースでコマンドを実行
pnpm run -r build
pnpm run -r test
```

## コントリビューション

プルリクエストを歓迎する。大きな変更の場合は、まずIssueを開いて変更内容を議論する。

## ライセンス

[MIT License](LICENSE)
