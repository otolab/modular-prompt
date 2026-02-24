---
name: experiment
description: modular-promptの実験フレームワーク（@modular-prompt/experiment）の使い方ガイド。プロンプトモジュールの比較・評価実験の設定、実行、評価器の定義を参照する。
---

# 実験フレームワーク使い方ガイド

## 実験フレームワークとは

`@modular-prompt/experiment` は、複数のプロンプトモジュールを同一条件下で比較・評価するためのフレームワーク。YAML設定で実験を定義し、CLIまたはプログラマティックに実行できる。

### ユースケース

- **プロンプト比較**: 異なるプロンプト構造の効果を比較検証
- **モジュール分離検証**: モジュール化したプロンプトが同等の出力を生成するか確認
- **品質評価**: 繰り返し実行による出力の安定性・一貫性の評価
- **マルチモデルテスト**: 異なるLLMプロバイダーでの動作比較

## CLI

```bash
# 設定検証・実行計画表示（まずこれで確認）
npx modular-experiment config.yaml --dry-run

# 実験実行
npx modular-experiment config.yaml

# 評価付き実行
npx modular-experiment config.yaml --evaluate

# 複数回実行（統計用）
npx modular-experiment config.yaml --repeat 10

# 特定モジュール・テストケースのみ
npx modular-experiment config.yaml --modules my-module --test-case "Basic Test"

# 詳細ログ出力
npx modular-experiment config.yaml --log-file experiment.jsonl --verbose
```

### CLIオプション

| オプション | 説明 |
|-----------|------|
| `<config>` | 設定ファイルパス（YAML or TypeScript） |
| `--dry-run` | 実行計画のみ表示 |
| `--evaluate` | 評価フェーズを有効化 |
| `--repeat <count>` | 繰り返し回数（デフォルト: 1） |
| `--modules <names>` | カンマ区切りモジュール名フィルター |
| `--test-case <name>` | テストケース名フィルター |
| `--model <provider>` | モデルプロバイダーフィルター |
| `--evaluators <names>` | カンマ区切り評価器名フィルター |
| `--log-file <path>` | JSONLログファイルパス |
| `--verbose` | 詳細な内部操作を表示 |

## 設定ファイル（YAML）

```yaml
# モデル定義
models:
  gpt4o:
    provider: openai
    model: gpt-4o
    capabilities: ["streaming", "tools", "structured"]
    enabled: true
  gemini:
    provider: vertexai
    model: gemini-2.0-flash-001
    capabilities: ["tools", "fast"]
    enabled: true

# ドライバー認証設定
drivers:
  openai:
    apiKey: ${OPENAI_API_KEY}      # 環境変数
  vertexai:
    projectId: my-gcp-project
    location: us-central1

# デフォルトオプション
defaultOptions:
  temperature: 0.7
  maxTokens: 2048

# テスト対象モジュール
modules:
  - name: baseline
    path: ./modules/baseline.ts     # 設定ファイルからの相対パス
    description: ベースラインプロンプト
  - name: optimized
    path: ./modules/optimized.ts
    description: 最適化版プロンプト

# テストケース
testCases:
  - name: 基本テスト
    description: 基本的な動作確認
    input:                          # module.compile に渡すコンテキスト
      query: "TypeScriptの型推論について説明して"
    models: [gpt4o]                 # オプション: 未指定時は全有効モデル
    queryOptions:                   # オプション
      temperature: 0.5

  - name: ツール呼び出しテスト
    input:
      query: "東京の天気を調べて"
    queryOptions:
      tools:
        - name: get_weather
          description: 天気を取得
          parameters:
            type: object
            properties:
              city: { type: string }
            required: [city]

# 評価器
evaluators:
  - name: structured-output-presence  # ビルトイン
  - name: llm-requirement-fulfillment # ビルトイン
  - name: custom-eval                 # 外部ファイル
    path: ./evaluators/custom-eval.ts

# 評価設定
evaluation:
  enabled: true
  model: gpt4o                        # 評価に使うモデル
```

### パス解決

設定ファイル内のパス（modules, evaluators等）は設定ファイルのディレクトリからの相対パスで解決される。`~/` でホームディレクトリ、絶対パスも使用可能。

## モジュール定義

テスト対象のモジュールファイル:

```typescript
import { compile } from '@modular-prompt/core';
import { myPromptModule } from './prompts.js';

export default {
  name: 'My Module',
  description: 'テスト対象のプロンプトモジュール',
  compile: (context: any) => compile(myPromptModule, context),
};
```

`compile` 関数はテストケースの `input` をコンテキストとして受け取り、CompiledPrompt を返す。

## 評価器

### ビルトイン評価器

**structured-output-presence** - コード評価器
- `structuredOutput` の存在と有効性を検証
- スコア: `(validCount / totalRuns) * 10`

**llm-requirement-fulfillment** - プロンプト評価器
- LLMが要件充足度を包括的に評価
- 評価基準: 要件充足度、パラメータ正確性、パラメータ完全性、論理的一貫性
- 評価用モデルの設定が必要（`evaluation.model`）

### カスタム評価器（コード）

```typescript
import type { CodeEvaluator, EvaluationContext, EvaluationResult } from '@modular-prompt/experiment';

export default {
  name: 'json-validator',
  description: 'JSON構造を検証',

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const allValid = context.runs.every(run =>
      run.queryResult.structuredOutput != null
    );
    return {
      evaluator: 'json-validator',
      moduleName: context.moduleName,
      score: allValid ? 10 : 0,
      reasoning: allValid ? '全実行でJSON出力あり' : 'JSON出力なし',
    };
  },
} satisfies CodeEvaluator;
```

### カスタム評価器（プロンプト）

LLMに評価させる場合:

```typescript
import type { PromptEvaluator, EvaluationContext } from '@modular-prompt/experiment';
import type { PromptModule } from '@modular-prompt/core';

const evaluationModule: PromptModule<EvaluationContext> = {
  createContext: () => ({ moduleName: '', prompt: '', runs: [] }),
  objective: ['出力の品質を0-10で評価する'],
  instructions: [
    '- 明確さ、正確さ、完全性を基準にする',
    (ctx) => `対象モジュール: ${ctx.moduleName}`,
    (ctx) => ctx.runs.map((run, i) =>
      `実行${i + 1}: ${run.queryResult.content.slice(0, 500)}`
    ),
  ],
};

export default {
  name: 'quality-evaluator',
  description: '出力品質を評価',
  module: evaluationModule,   // baseEvaluationModuleと自動マージされる
} satisfies PromptEvaluator;
```

## 主要な型

### TestCase

```typescript
interface TestCase {
  name: string;
  description?: string;
  input: any;                          // module.compileに渡すコンテキスト
  models?: string[];                   // 未指定時は全有効モデル
  queryOptions?: Partial<QueryOptions>;
}
```

### EvaluationContext

```typescript
interface EvaluationContext {
  moduleName: string;
  prompt: string;         // コンパイル済みプロンプト（文字列化）
  runs: Array<{
    queryResult: QueryResult;
  }>;
}
```

### EvaluationResult

```typescript
interface EvaluationResult {
  evaluator: string;
  moduleName: string;
  score?: number;         // 0-10
  reasoning?: string;
  details?: Record<string, any>;
  error?: string;
}
```

## プログラマティック使用

```typescript
import {
  loadExperimentConfig,
  loadModules,
  loadEvaluators,
  ExperimentRunner,
  DriverManager,
} from '@modular-prompt/experiment';

const { serverConfig, aiService, configDir } = loadExperimentConfig('config.yaml');
const modules = await loadModules(serverConfig.modules, configDir);
const evaluators = await loadEvaluators(serverConfig.evaluators, configDir);

const driverManager = new DriverManager();
const runner = new ExperimentRunner(
  aiService,
  driverManager,
  modules,
  serverConfig.testCases,
  serverConfig.models,
  5,           // repeat count
  evaluators,
  evaluatorModel
);

const results = await runner.run();
await driverManager.cleanup();
```

## 実験フロー

```
設定ロード → モジュール・評価器ロード → テストケースごとに:
  全モジュールをコンパイル → プロンプト比較 → 各モデルで実行（繰り返し対応）
→ 評価フェーズ（オプション） → 統計レポート生成 → クリーンアップ
```

DriverManagerがモデル名をキーにドライバーをキャッシュし、同じモデルであればドライバーを再利用する。異なるモデルに切り替わると前のドライバーをcloseできる。これはローカルLLM（MLX等）のメモリ消費を抑えるための設計。
