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
| `PyTorchDriver` | PyTorch | Transformers + PyTorch（LIP、cpu-minimal 自動セットアップ） |
| `VllmDriver` | vLLM | CUDA GPU推論（Linux） |
| `TestDriver` | - | モックレスポンス |
| `EchoDriver` | - | プロンプトをそのまま返す |

各ドライバーの詳細な設定・オプションは `skills/driver-usage/SKILL.md` を参照。

## 主な機能

- **統一インターフェース**: `query()` / `streamQuery()` / `close()` の3メソッド
- **推論キャンセル**: `QueryOptions.signal`（`AbortSignal`）— 現時点は MLX ドライバーで実装
- **トークン使用量**: `QueryResult.usage`（`cacheReadTokens` / `cacheWriteTokens` 含む）
- **ツール呼び出し**: Function Calling対応（OpenAI、Anthropic、VertexAI、GoogleGenAI）
- **構造化出力**: JSONスキーマによる出力制御
- **AIService**: 能力ベースのモデル自動選択

## ユーザーモデル設定（`~/.modular-prompt/models.yaml`）

マシン共通のモデル定義を `~/.modular-prompt/models.yaml` に置けます（`MODULAR_PROMPT_HOME` で上書き可）。**プロジェクト配下の暗黙探索は行いません。** 利用側アプリが base / overlay を明示投入し、**overlay > user > base** の優先順位で解決します。

```yaml
models:
  default:
    provider: mlx
    model: mlx-community/gemma-3-270m-it-4bit
  local-chat:
    provider: mlx
    model: mlx-community/gemma-3-270m-it-4bit
    capabilities: [local, chat, tools]
```

```typescript
import {
  resolveModelName,
  resolveDefaultModelFromConfig,
  AIService,
} from '@modular-prompt/driver';

const bundled = {
  models: {
    default: { provider: 'mlx', model: 'app/default' },
  },
} as const;

const profileOverlay = {
  models: {
    'local-chat': { provider: 'mlx', model: 'my-app/local' },
  },
};

const ai = AIService.fromMergedConfig(bundled, profileOverlay);
const models = ai.modelsConfig;

const spec = resolveModelName('local-chat', models, () => 'mlx');
const fallback = resolveDefaultModelFromConfig(models);
const driver = await ai.createDriver(spec);
```

- `AIService.fromMergedConfig(base, overlay)` — base + overlay をマージし、デフォルトで user yaml も取り込む
- `AIService.fromModelsConfig({ source })` — `source: 'merge'`（デフォルト）で user yaml を読み込み、`source: 'overlay'` で無視
- `mode: 'merge' | 'override'` — models セクションの浅いマージ / 置換
- デフォルト model は `models.default` alias、なければ models の先頭エントリから導出
- `defaults` / `runtime` による暗黙解決は廃止（YAML に残っていても警告のみ）

simple-chat では profile の `modelsConfig` に inline の `models` / `drivers` を載せ、`workflow.models.default.ref` で alias 参照できます。`ref` に未知の alias を指定した場合は **エラーで停止**します。

不正な YAML は `loadModelsConfigFile()` が **例外を throw** します（js-yaml のパースエラーをそのまま伝播）。


```typescript
import { MlxDriver } from '@modular-prompt/driver';

const driver = new MlxDriver({ model: 'mlx-community/...' });
const controller = new AbortController();

const { stream, result } = await driver.streamQuery(prompt, {
  signal: controller.signal,
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// 途中でキャンセルする場合
controller.abort();

const final = await result;
// final.finishReason === 'error' かつ controller.signal.aborted → キャンセル
```

- `result` はキャンセル時も **reject しません**（`finishReason: 'error'` で resolve）
- キャンセル前の部分応答は `result.content` に残ります
- 他ドライバーは `signal` を無視します（未実装）

詳細は [Driver APIリファレンス](../../docs/DRIVER_API.md#推論キャンセルabortsignal) を参照。

## トークン使用量（usage）

```typescript
const { stream, result } = await driver.streamQuery(prompt, { cache: true });
for await (const _ of stream) { /* consume */ }

const final = await result;
if (final.usage) {
  console.log(final.usage.promptTokens, final.usage.completionTokens);
  console.log(final.usage.cacheReadTokens);   // MLX + KV キャッシュ時
  console.log(final.usage.cacheWriteTokens);  // 同一クエリ内の新規 prefill 時
}
```

usage は `stream` の各チャンクではなく **`result.usage` のみ** に載ります。

## 共通ユーティリティ（query-utils）

カスタムドライバーやアダプタ向けヘルパー:

```typescript
import {
  buildQueryUsage,
  createAbortedStreamResult,
  isAborted,
  watchAbortSignal,
} from '@modular-prompt/driver';
```

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

MLX ドライバーを使う前に Python ランタイムのセットアップが必要です（macOS のみ）:

```bash
# monorepo ルートから
pnpm run setup-mlx

# @modular-prompt/driver を npm インストールした場合
modular-runtime setup mlx
```

ランタイムは `~/.modular-prompt/runtimes/mlx/` に作成されます。状態確認は `pnpm --filter @modular-prompt/driver run runtime:status`（monorepo）または `modular-runtime setup --status`。

前提条件: Python 3.13、Apple Silicon Mac、uv。

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

#### Thinking系モデルの推論深度制御

`reasoningEffort` オプションで推論深度を制御できます（llm-jp-4-thinking等に対応）:

```typescript
const result = await driver.query(prompt, {
  reasoningEffort: 'high',  // 'low' | 'medium' | 'high'
  temperature: 0.7
});

// thinking チャネルの内容を取得
if (result.thinkingContent) {
  console.log('Thinking:', result.thinkingContent);
}
console.log('Response:', result.content);
```

**対応モデル**:
- `llm-jp-4-*-thinking` シリーズ（Harmonyフォーマット）
- `reasoningEffort` は Python側の `apply_chat_template` に渡されます

**Harmonyフォーマット**: llm-jp-4が採用するOpenAI Harmony Response Format。スペシャルトークン（`<|start|>`, `<|channel|>`, `<|message|>` 等）でメッセージを分割し、`analysis` チャネルを `thinkingContent`、`final` チャネルを `content` に振り分けます。

**技術詳細**: Harmonyフォーマットの後処理設計、ResponseProcessorアーキテクチャ、tool call形式については [prompts/memos/harmony-format-postprocessing.v1.md](../../prompts/memos/harmony-format-postprocessing.v1.md) を参照してください。

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
