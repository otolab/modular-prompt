# @modular-prompt/driver

AIモデルドライバーパッケージ - 様々なAIプロバイダーとの統一されたインターフェースを提供。

## インストール

```bash
npm install @modular-prompt/driver
```

## 基本的な使い方

```typescript
import { compile } from '@modular-prompt/core';
import { OpenAIDriver } from '@modular-prompt/driver';

const driver = new OpenAIDriver({ model: 'gpt-4o-mini' });
const prompt = compile(myModule, context);

// クエリ
const result = await driver.query(prompt, { temperature: 0.7 });
console.log(result.content);

// ストリーミング
const { stream, result: resultPromise } = await driver.streamQuery(prompt);
for await (const chunk of stream) {
  process.stdout.write(chunk);
}

await driver.close();
```

## 利用可能なドライバー

| ドライバー | プロバイダー | 備考 |
|-----------|------------|------|
| `OpenAIDriver` | OpenAI | OpenAI互換API対応 |
| `AnthropicDriver` | Anthropic | Claude |
| `VertexAIDriver` | Google Cloud | Vertex AI経由Gemini |
| `GoogleGenAIDriver` | Google | APIキーのみで利用可能 |
| `OllamaDriver` | Ollama | ローカルLLM |
| `MlxDriver` | MLX | Apple Silicon専用 |
| `TestDriver` | - | モックレスポンス |
| `EchoDriver` | - | プロンプトをそのまま返す |

各ドライバーの詳細な設定・オプションは `skills/driver-usage/SKILL.md` を参照。

## 主な機能

- **統一インターフェース**: `query()` / `streamQuery()` / `close()` の3メソッド
- **ツール呼び出し**: Function Calling対応（OpenAI、Anthropic、VertexAI、GoogleGenAI）
- **構造化出力**: JSONスキーマによる出力制御
- **AIService**: 能力ベースのモデル自動選択

## カスタムドライバーの作成

`AIDriver` インターフェースを実装:

```typescript
import type { AIDriver, CompiledPrompt, QueryOptions, QueryResult, StreamResult } from '@modular-prompt/driver';

export class CustomDriver implements AIDriver {
  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    // 実装
  }

  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
    // 実装
  }

  async close(): Promise<void> {
    // リソースのクリーンアップ
  }
}
```

## MLX セットアップ

MLXドライバーはインストール時に自動でPython環境をセットアップする。手動で実行する場合:

```bash
cd node_modules/@modular-prompt/driver
npm run setup-mlx
```

前提条件: Python 3.11以上、Apple Silicon Mac、uv。

## Skills（Claude Code向け）

このパッケージには `skills/driver-usage/SKILL.md` が同梱されています。Claude Codeのスキルとして利用でき、ドライバーの使い方をガイドします。

## ライセンス

MIT
