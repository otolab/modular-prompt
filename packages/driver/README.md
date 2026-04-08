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

## エラーハンドリング

すべてのドライバーは `QueryResult` を通じて統一されたエラー情報を提供します。

```typescript
const result = await driver.query(prompt);

if (result.finishReason === 'error') {
  // errors フィールドでエラー詳細を確認
  if (result.errors) {
    for (const entry of result.errors) {
      console.error(`[${entry.prefix}] ${entry.message}`);
    }
  }
}

// logEntries で全レベルのログを確認可能
if (result.logEntries) {
  console.log(`Query produced ${result.logEntries.length} log entries`);
}
```

詳細は [Driver APIリファレンス](../../docs/DRIVER_API.md) を参照してください。

## 利用可能なドライバー

| ドライバー | プロバイダー | 備考 |
|-----------|------------|------|
| `OpenAIDriver` | OpenAI | OpenAI互換API対応 |
| `AnthropicDriver` | Anthropic | Claude（Vertex経由も可） |
| `VertexAIDriver` | Google Cloud | Gemini + Model Garden（Qwen, Llama等） |
| `GoogleGenAIDriver` | Google | APIキーのみで利用可能 |
| `OllamaDriver` | Ollama | ローカルLLM |
| `MlxDriver` | MLX | Apple Silicon専用（VLM対応） |
| `VllmDriver` | vLLM | CUDA GPU推論（Linux） |
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

## ローカルモデルのセットアップ

### MLX（Apple Silicon）

MLXドライバーはインストール時に自動でPython環境をセットアップします。手動で実行する場合:

```bash
cd node_modules/@modular-prompt/driver
npm run setup-mlx
```

前提条件: Python 3.11以上、Apple Silicon Mac、uv。

#### VLMモデルのtext-only使用

VLM（Vision Language Model）対応モデルを画像なしのテキストのみで使用する場合は、`textOnly`オプションを使用します。

```typescript
import { MlxDriver } from '@modular-prompt/driver';

const driver = new MlxDriver({
  model: 'mlx-community/Qwen2-VL-2B-Instruct-4bit',
  textOnly: true,  // VLMモデルをtext-onlyモードで起動
  defaultOptions: {
    temperature: 0.7,
    maxTokens: 500
  }
});

const result = await driver.query(prompt);
console.log(result.content);

await driver.close();
```

`textOnly: true`を指定すると、VLM対応モデルを`mlx-lm`（高速起動）で起動し、画像処理なしのテキストのみで使用できます。

#### 特殊トークンの確認

モデルがサポートする特殊トークンを確認できます:

```bash
npx tsx scripts/check-special-tokens.ts <model-name>
# 例:
npx tsx scripts/check-special-tokens.ts mlx-community/gemma-3-270m-it-qat-8bit
```

### vLLM（CUDA GPU）

vLLMドライバーは独立したPythonエンジンプロセスとして起動します。

```bash
# 環境のセットアップ
cd node_modules/@modular-prompt/driver/src/vllm/python
uv sync

# エンジンの起動
uv --project . run python __main__.py \
  --model Qwen/Qwen2.5-7B-Instruct \
  --socket /tmp/vllm.sock \
  --tool-call-parser hermes
```

前提条件: Python 3.10以上、CUDA対応GPU、Linux。

詳細は [ローカルモデルセットアップガイド](../../docs/LOCAL_MODEL_SETUP.md) を参照してください。

## Skills（Claude Code向け）

このパッケージには `skills/driver-usage/SKILL.md` が同梱されています。Claude Codeのスキルとして利用でき、ドライバーの使い方をガイドします。

## ライセンス

MIT
