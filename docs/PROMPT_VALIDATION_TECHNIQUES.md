# プロンプト検証テクニック

プロンプト設計の問題を特定し、改善するための実践的な検証手法。

## 概要

プロンプトの品質を評価するアプローチは大きく2つある。

- **手動検証**: simple-chatを使ってモデルに対話的に質問し、問題を探索的に分析する
- **実験フレームワーク**: `@modular-prompt/experiment` でYAML設定に基づく体系的な比較・評価を行う

手動検証で問題を発見・分析し、実験フレームワークで改善を定量的に確認するのが典型的なワークフロー。

## 実験フレームワーク（@modular-prompt/experiment）

複数のプロンプトモジュールを同一条件下で比較・評価するためのフレームワーク。YAML設定で実験を定義し、CLIで実行する。

### ユースケース

- **プロンプト比較**: 異なるプロンプト構造の効果を定量的に比較
- **モジュール分離検証**: モジュール化したプロンプトが同等の出力を生成するか確認
- **品質評価**: 繰り返し実行による出力の安定性・一貫性の評価
- **マルチモデルテスト**: 異なるLLMプロバイダーでの動作比較

### 基本的な流れ

```
設定ファイル作成 → dry-runで確認 → 実験実行 → 評価（オプション）→ 結果分析
```

### 設定ファイルの作成

YAML形式で実験の構成要素を定義する。

```yaml
# experiment-config.yaml

# 使用するモデルの定義
models:
  gpt4o:
    provider: openai
    model: gpt-4o
    capabilities: ["streaming", "tools", "structured"]
  gemma-local:
    model: "mlx-community/gemma-3-12b-it-qat-4bit"
    provider: "mlx"
    capabilities: ["local", "fast", "tools"]

# ドライバー認証設定
drivers:
  openai:
    apiKey: ${OPENAI_API_KEY}       # 環境変数を参照
  mlx: {}

# デフォルトオプション
defaultOptions:
  temperature: 0.7
  maxTokens: 2048

# テスト対象のプロンプトモジュール
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
    queryOptions:
      temperature: 0.5

# 評価器
evaluators:
  - name: structured-output-presence   # ビルトイン
  - name: llm-requirement-fulfillment  # ビルトイン
  - name: custom-eval                  # 外部ファイル
    path: ./evaluators/custom-eval.ts

# 評価設定
evaluation:
  enabled: true
  model: gpt4o                      # 評価に使うモデル
```

パス（modules, evaluators等）は設定ファイルのディレクトリからの相対パスで解決される。`~/` でホームディレクトリ、絶対パスも使用可能。

### モジュールファイルの作成

テスト対象のモジュールファイルでは、`compile` 関数がテストケースの `input` をコンテキストとして受け取り、CompiledPrompt を返す。

```typescript
// modules/baseline.ts
import { compile } from '@modular-prompt/core';
import { myPromptModule } from './prompts.js';

export default {
  name: 'Baseline Module',
  description: 'ベースラインのプロンプト構造',
  compile: (context: any) => compile(myPromptModule, context),
};
```

### CLIでの実行

```bash
# 設定検証・実行計画の確認（まずこれで確認する）
npx modular-experiment config.yaml --dry-run

# 実験実行
npx modular-experiment config.yaml

# 評価付き実行
npx modular-experiment config.yaml --evaluate

# 複数回実行（統計用）
npx modular-experiment config.yaml --repeat 10

# 特定モジュール・テストケースのみ実行
npx modular-experiment config.yaml --modules baseline --test-case "基本テスト"

# 詳細ログ出力
npx modular-experiment config.yaml --log-file experiment.jsonl --verbose
```

**CLIオプション一覧**:

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

### 評価器

#### ビルトイン評価器

- **structured-output-presence**: `structuredOutput` の存在と有効性を検証する。スコアは `(validCount / totalRuns) * 10`
- **llm-requirement-fulfillment**: LLMが要件充足度を包括的に評価する。評価基準は要件充足度、パラメータ正確性、パラメータ完全性、論理的一貫性。`evaluation.model` の設定が必要

#### カスタム評価器（コード）

プログラムで出力を検証する場合:

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

#### カスタム評価器（プロンプト）

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

### プログラマティックな使用

CLIを使わずコードから実験を実行することもできる。

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

### 活用例: ツール呼び出しの動作検証

異なるモデルでのtool calling対応を比較検証する例:

```yaml
models:
  qwen3-4b:
    model: "mlx-community/Qwen3-4B-Thinking-2507-heretic-8bit"
    provider: "mlx"
    capabilities: ["local", "tools"]
  gemma3-12b:
    model: "mlx-community/gemma-3-12b-it-qat-4bit"
    provider: "mlx"
    capabilities: ["local", "tools"]

drivers:
  mlx: {}

modules:
  - name: tools-test
    path: ./tools-test-module.mjs
    description: "ツール呼び出し実験用"

testCases:
  - name: 天気ツール呼び出し
    description: "get_weatherツールを呼び出すことを期待"
    input:
      question: "東京の天気を教えてください。"
    queryOptions:
      temperature: 0.3
      maxTokens: 512
      tools:
        - name: get_weather
          description: "指定された場所の現在の天気を取得する"
          parameters:
            type: object
            properties:
              location:
                type: string
                description: "天気を取得する場所（都市名）"
            required: [location]
      toolChoice: auto

  - name: ツール不要の質問
    description: "ツールを呼び出さずにテキストで回答することを期待"
    input:
      question: "1 + 1 は何ですか？"
    queryOptions:
      temperature: 0.3
      maxTokens: 1024
      tools:
        - name: get_weather
          description: "指定された場所の現在の天気を取得する"
          parameters:
            type: object
            properties:
              location:
                type: string
            required: [location]
      toolChoice: auto
```

## 注意点

### モデルの自己認識の限界

モデルは自身の振る舞いを完全に説明できない場合がある。
- 実際の生成では失敗するが、分析では正しい答えを出すことがある
- 逆に、正しく生成できても、理由を説明できない場合がある

### コンテキストの違い

検証用の質問と実際のタスク実行では、コンテキストが異なる。
- 検証時: メタ認知モード（プロンプトについて考える）
- 実行時: タスク実行モード（プロンプトに従う）

### バイアスの可能性

モデルは人間の期待に沿った回答をする傾向がある。
- 質問の仕方によって回答が変わる可能性
- 複数の質問方法で確認することを推奨

## 関連ドキュメント

- [Simple Chat README](../packages/simple-chat/README.md)
- [Testing Strategy](./TESTING_STRATEGY.md)
