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

  - name: マルチモデルテスト
    description: 役割別に異なるモデルを使用
    input:
      query: "複雑な問題を解決する"
    models:
      - default: gpt4o              # インライン DriverSet 定義
        thinking: gemini            # thinking役割用のモデル
      - gpt4o                       # 単一モデル指定（従来通り）

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

### テストケースのモデル指定

`testCases[].models` フィールドでは、以下の2種類の指定が可能です:

**1. 文字列（モデル名）**: 単一のドライバーを使用
```yaml
models: [gpt4o, gemini]
```

**2. オブジェクト（DriverSet）**: 役割別に異なるドライバーを指定
```yaml
models:
  - default: gpt4o      # 必須: デフォルトの役割
    thinking: gemini    # オプション: thinking役割用
    chat: claude        # オプション: chat役割用
```

役割は `ModelRole = 'default' | 'thinking' | 'instruct' | 'chat' | 'plan'` から選択できます。未指定の役割は自動的に `default` にフォールバックします。

## モジュール定義

テスト対象のモジュールファイルでは、PromptModule を直接 default export する:

```typescript
import type { PromptModule } from '@modular-prompt/core';

const module: PromptModule<{ query: string }> = {
  objective: ['ユーザーの質問に回答する'],
  instructions: [
    '- 正確で分かりやすい説明を心がける',
    (ctx) => `質問: ${ctx.query}`,
  ],
};

export default module;
```

テストケースの `input` は実行時にコンテキストとして注入される。runner 内部で `defaultProcess` を使用してコンパイル・実行が行われる。

### 制限事項: ワークフロー関数の固定

現状、`ExperimentRunner` は **`defaultProcess` がハードコード**されており、`agenticProcess` や `streamProcess` などの別のワークフロー関数に差し替える機能は実装されていません。

**現在の実装** (`packages/experiment/src/runner/experiment.ts` L250):
- `defaultProcess` が直接呼び出される
- `TestCase`, `ModuleDefinition`, `ExperimentRunner` のいずれにもワークフロー指定フィールドなし
- YAML設定でもワークフロー関数を指定する手段なし

**今後の拡張方向**:
異なるワークフロー（agenticProcess等）を実験フレームワークで使用可能にするには、以下の機能追加が必要です:

1. **`TestCase` または `ModuleDefinition` に `process` フィールドを追加**
   - YAML設定で `process: "./workflows/my-workflow.ts"` のようにパス指定
2. **`ExperimentRunner.runModuleTest()` でワークフロー関数を選択可能にする**
   - デフォルトは `defaultProcess` を維持（後方互換）
3. **ワークフロー関数のロード機構**
   - evaluator/moduleと同様に外部ファイルから関数をimport

この拡張により、実験フレームワーク上で異なる処理戦略（エージェント型、ストリーム処理等）を比較検証できるようになります。

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

実験は3つのフェーズに分けて実行される:

### Phase 1: テスト計画の生成 (buildTestPlan)
- テストケース × モデル × モジュール の全組み合わせを展開
- 各組み合わせに順序番号（order）を付与して計画リストを作成
- コンパイル済みプロンプトを事前生成（ログ・評価用）

### Phase 2: 実行フェーズ (executePlan)
- **モデルごとにグループ化して実行**（モデル切り替えコストの最小化）
- 各モデルグループで:
  - ドライバーを作成
  - テストケース × モジュール の組み合わせを実行（`defaultProcess` を使用）
  - モデルのテスト完了後にドライバーをクローズ
- **実行完了後、元の定義順にソート** (retire)

### Phase 3: 評価フェーズ (runEvaluationPhase)
- 評価器が有効な場合のみ実行
- 各モジュールの出力を評価器で採点
- 評価結果を表示

### 設計上の特徴

**アウトオブオーダー実行**: モデルごとにグループ化して実行することで、ローカルLLM（MLX等）のモデル切り替えコストを削減。実行後は元の定義順にソートして結果を返す。

**ドライバーキャッシング**: DriverManagerがモデル名をキーにドライバーをキャッシュ。同じモデルであればドライバーを再利用し、異なるモデルに切り替わると前のドライバーをcloseする。
