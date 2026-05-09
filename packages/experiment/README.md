# @modular-prompt/experiment

プロンプトモジュールの比較・評価フレームワーク。

## インストール

```bash
npm install @modular-prompt/experiment
```

## 概要

複数のプロンプトモジュールを同一条件下で比較・評価する。YAML設定で実験を定義し、CLIで実行。

- **プロンプト比較**: 異なるプロンプト構造の効果を定量的に比較
- **マルチモデルテスト**: 異なるLLMプロバイダーでの動作比較
- **品質評価**: 繰り返し実行による安定性・一貫性の評価
- **柔軟な評価器**: コードベース・AIベースの評価をサポート

## クイックスタート

### 1. 設定ファイルを作成

```yaml
# experiment.yaml
models:
  gpt4o:
    provider: openai
    model: gpt-4o

drivers:
  openai:
    apiKey: ${OPENAI_API_KEY}

modules:
  - name: my-module
    path: ./my-module.ts

testCases:
  - name: 基本テスト
    input:
      query: "TypeScriptについて説明して"

evaluators: []
```

### 2. モジュールファイルを作成

```typescript
// my-module.ts
import type { PromptModule } from '@modular-prompt/core';

const module: PromptModule<{ query: string }> = {
  objective: ['ユーザーの質問に回答する'],
  instructions: [
    (ctx) => `質問: ${ctx.query}`,
  ],
};

export default module;
```

### 3. 実行

```bash
npx modular-experiment experiment.yaml --dry-run    # 確認
npx modular-experiment experiment.yaml              # 実行
npx modular-experiment experiment.yaml --evaluate   # 評価付き
npx modular-experiment experiment.yaml --repeat 10  # 複数回実行
```

## 設定ファイルの詳細

### モデル指定: DriverSet記法

テストケースの `models` フィールドでは、単一のモデル名（文字列）または役割別モデルのマッピング（オブジェクト）を指定できます。

#### 単一モデル（文字列）

すべての役割で同じモデルを使用します。

```yaml
testCases:
  - name: 基本テスト
    input:
      query: "質問内容"
    models:
      - gpt4o  # すべての役割でgpt4oを使用
```

#### DriverSet（役割別モデル）

役割ごとに異なるモデルを指定できます。`default` は必須で、他の役割（`thinking`、`instruct`、`chat`、`plan`）はオプションです。未指定の役割は自動的に `default` にフォールバックします。

```yaml
models:
  gemma4:
    provider: mlx
    model: gemma4-26b-a4b
  qwen:
    provider: mlx
    model: qwen3.5-9b

testCases:
  - name: 役割別モデルテスト
    input:
      query: "質問内容"
    models:
      - default: gemma4     # 通常のタスクはgemma4
        thinking: qwen      # thinking役割はqwen
```

**利用可能なModelRole:**
- `default`: 必須。メインのモデル
- `thinking`: 推論タスク用（オプション）
- `instruct`: 指示実行用（オプション）
- `chat`: 対話用（オプション）
- `plan`: 計画立案用（オプション）

**注記:** 値には設定ファイルのトップレベル `models:` セクションで定義されたモデル名を指定します。

## Skills (for Claude Code)

This package includes `skills/experiment/SKILL.md`. It can be used as a Claude Code skill to guide experiment framework usage.

## License

MIT
