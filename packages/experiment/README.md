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

#### CLIオプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--test-case <name>` | テストケース名フィルター（指定した名前のみ実行） | all |
| `--model <provider>` | モデルプロバイダーフィルター（例: `mlx`, `vertexai`, `googlegenai`） | すべての有効なモデル |
| `--modules <names>` | カンマ区切りのモジュール名（指定したモジュールのみテスト） | all |
| `--repeat <count>` | 実行回数（統計的な評価に有用） | 1 |
| `--evaluate` | AI評価器を有効化（評価フェーズを実行） | false |
| `--evaluators <names>` | カンマ区切りの評価器名（指定した評価器のみ使用） | all |
| `--dry-run` | 実行計画の表示のみ（実験を実行しない） | false |
| `--verbose` | 詳細なログ出力（内部処理の表示） | false |
| `--log-file <path>` | 詳細ログのJSONL出力先ファイルパス | なし |
| `--trace-dir <dir>` | 構造化された実行ログの出力ディレクトリ（prefix/contextごとにファイル分割、summary.json付き） | なし |
| `--output <path>` | 実験結果のJSON出力先ファイルパス（メタデータと結果を含む） | なし |

**ログ・トレースオプション詳細:**
- `--log-file`: 全実行ログをJSONL形式で1ファイルに出力。各行が1ログエントリ。
- `--trace-dir`: ログをprefix/context別にファイル分割して出力。summary.jsonに全体統計を含む。読みやすい形式（タイムスタンプ + レベル + メッセージ）。
- `--output`: 実験結果を構造化JSON形式で保存。タイムスタンプ、使用モデル、繰り返し回数などのメタデータを含む。

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
