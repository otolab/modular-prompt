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
import { compile } from '@modular-prompt/core';

export default {
  name: 'My Module',
  compile: (context: any) => compile(myPromptModule, context),
};
```

### 3. 実行

```bash
npx modular-experiment experiment.yaml --dry-run    # 確認
npx modular-experiment experiment.yaml              # 実行
npx modular-experiment experiment.yaml --evaluate   # 評価付き
npx modular-experiment experiment.yaml --repeat 10  # 複数回実行
```

設定ファイルの詳細、評価器の書き方、プログラマティックAPIについては `skills/experiment/SKILL.md` を参照。

## Skills (for Claude Code)

This package includes `skills/experiment/SKILL.md`. It can be used as a Claude Code skill to guide experiment framework usage.

## License

MIT
