# ローカルモデルセットアップガイド

ローカル環境でAIモデルを実行するための完全ガイド。

## 目次

- [MLX (Apple Silicon)](#mlx-apple-silicon)
  - [環境要件](#環境要件)
  - [初回セットアップ](#初回セットアップ)
  - [テスト用モデルのダウンロード](#テスト用モデルのダウンロード)
  - [任意のモデルのダウンロード](#任意のモデルのダウンロード)
  - [トラブルシューティング](#トラブルシューティング-mlx)
- [PyTorch (Transformers, cpu-minimal)](#pytorch-transformers-cpu-minimal)
  - [環境要件](#環境要件-pytorch)
  - [初回セットアップ](#初回セットアップ-pytorch)
  - [手動カスタマイズ](#手動カスタマイズ-pytorch)
  - [トラブルシューティング](#トラブルシューティング-pytorch)
- [Ollama](#ollama)
  - [インストール](#インストール)
  - [サービスの起動](#サービスの起動)
  - [モデルのダウンロード](#モデルのダウンロード-1)
  - [トラブルシューティング](#トラブルシューティング-ollama)
- [vLLM (CUDA GPU)](#vllm-cuda-gpu)
  - [環境要件](#環境要件-1)
  - [初回セットアップ](#初回セットアップ-1)
  - [エンジンの起動](#エンジンの起動)
  - [トラブルシューティング](#トラブルシューティング-vllm)

## MLX (Apple Silicon)

Apple Silicon Mac専用の高速ローカルLLM実行環境。

### 環境要件

- **ハードウェア**: Apple Silicon Mac (M1/M2/M3/M4)
- **OS**: macOS
- **Python**: 3.11以上
- **uv**: Pythonパッケージマネージャー（自動インストールされます）

### 初回セットアップ

MLX ドライバーを使うには、Python ランタイムを **明示的にセットアップ** します（`npm install` では自動セットアップされません）。

```bash
# プロジェクトルートから
npm run setup-mlx -w @modular-prompt/driver

# またはパッケージディレクトリから
cd node_modules/@modular-prompt/driver
npm run setup-mlx
```

Python 環境は `~/.modular-prompt/runtimes/mlx/` に作成されます（プロジェクトや `node_modules` 内には作られません）。

**状態確認・掃除:**

```bash
npm run runtime:status -w @modular-prompt/driver
npm run runtime:cleanup -w @modular-prompt/driver mlx -- --yes
```

**セットアップ内容：**

1. uv パッケージマネージャーのインストール（未インストールの場合）
2. `~/.modular-prompt/runtimes/mlx/.venv` に Python 仮想環境を作成
3. MLX 関連パッケージのインストール

### テスト用モデルのダウンロード

開発・テスト・動作確認用の小型モデルをダウンロードできます：

```bash
cd node_modules/@modular-prompt/driver
npm run download-model
```

**モデル情報：**
- **モデル名**: `mlx-community/gemma-3-270m-it-4bit`
- **サイズ**: 約270MB
- **用途**: 動作確認、開発、ユニットテスト

このモデルは軽量で、MLX環境が正しく動作しているかを確認するのに最適です。

### 任意のモデルのダウンロード

Hugging Face上の任意のMLXモデルをダウンロードできます。

**推奨（テスト用モデル）:**

```bash
pnpm run download-model -w @modular-prompt/driver
```

**手動で任意モデルを取得する場合**（`UV_PROJECT_ENVIRONMENT` でホーム venv を指定）:

```bash
cd node_modules/@modular-prompt/driver/src/mlx-ml/python
UV_PROJECT_ENVIRONMENT=~/.modular-prompt/runtimes/mlx/.venv \
  uv run mlx_lm.generate --model <model-name> --prompt "test" --max-tokens 1
```

**例：**

```bash
# Gemma 2B
UV_PROJECT_ENVIRONMENT=~/.modular-prompt/runtimes/mlx/.venv \
  uv run mlx_lm.generate --model mlx-community/gemma-2-2b-it-4bit --prompt "test" --max-tokens 1

# Llama 3.2 3B
UV_PROJECT_ENVIRONMENT=~/.modular-prompt/runtimes/mlx/.venv \
  uv run mlx_lm.generate --model mlx-community/Llama-3.2-3B-Instruct-4bit --prompt "test" --max-tokens 1
```

**モデルの保存場所：**

```
~/.cache/huggingface/hub/
```

**注意：**
- 初回実行時にモデルが自動ダウンロードされるため、事前ダウンロードは必須ではありません
- モデルサイズに応じて、ダウンロードに時間がかかる場合があります

### トラブルシューティング (MLX)

#### Python環境が見つからない

```bash
# uvの再インストール
curl -LsSf https://astral.sh/uv/install.sh | sh

# MLX環境の再セットアップ
cd node_modules/@modular-prompt/driver
npm run setup-mlx
```

#### モデルのダウンロードが失敗する

```bash
# キャッシュをクリア
rm -rf ~/.cache/huggingface/hub/

# 再度ダウンロード
npm run download-model
```

#### メモリ不足エラー

より小さいモデル（テスト用の270MBモデルなど）を使用するか、他のアプリケーションを終了してメモリを確保してください。

## PyTorch (Transformers, cpu-minimal)

Windows / Linux など **MLX が使えない環境**向けの Thin Python 推論ドライバ（Local Inference Protocol）。

- **自動セットアップは CPU 最小構成のみ**（`torch` CPU wheel + `transformers`）
- CUDA / GPU / 量子化は **手動調整**（下記「手動カスタマイズ」）
- Linux + NVIDIA で本番寄りの推論が必要な場合は [vLLM](#vllm-cuda-gpu) を検討

### 環境要件 (PyTorch)

- **OS**: Windows / Linux / macOS（macOS では MLX を推奨）
- **Python**: 3.12（`setup-pytorch` が venv に使用）
- **uv**: パッケージマネージャー（未インストール時は自動インストール）

### 初回セットアップ (PyTorch)

```bash
# プロジェクトルートから
pnpm run setup-pytorch -w @modular-prompt/driver

# 状態確認
pnpm run runtime:status -w @modular-prompt/driver
```

Python 環境は `~/.modular-prompt/runtimes/pytorch/.venv` に作成されます。

**セットアップ内容：**

1. `uv venv --python 3.12`
2. `torch==2.9.1` を **CPU index** からインストール
3. `transformers` 等の最小依存を editable install

### 手動カスタマイズ (PyTorch)

#### CUDA 版 torch への差し替え

```bash
PYTORCH_DIR=~/.modular-prompt/runtimes/pytorch
cd node_modules/@modular-prompt/driver/src/pytorch/python

# 例: CUDA 12.4（環境に合わせて index を選ぶ）
UV_PROJECT_ENVIRONMENT=$PYTORCH_DIR/.venv \
  uv pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124

UV_PROJECT_ENVIRONMENT=$PYTORCH_DIR/.venv \
  uv run python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

[CUDA 対応表は PyTorch 公式](https://pytorch.org/get-started/locally/)を参照してください。

#### 外部 venv / conda の利用

```typescript
import { PyTorchDriver } from '@modular-prompt/driver';

const driver = new PyTorchDriver({
  model: 'gpt2',
  venvPath: '/path/to/existing/.venv',
  device: 'cuda',
});
```

または環境変数 `MODULAR_PROMPT_PYTORCH_VENV` で venv パスを指定できます。

#### 追加依存（accelerate / 量子化など）

```bash
UV_PROJECT_ENVIRONMENT=~/.modular-prompt/runtimes/pytorch/.venv \
  uv pip install accelerate
```

モデル要件に応じてユーザーが選択する想定です。`setup-pytorch` には含めません。

### トラブルシューティング (PyTorch)

#### venv が見つからない

```bash
pnpm run setup-pytorch -w @modular-prompt/driver
```

#### CUDA が有効にならない

手動カスタマイズの CUDA 差し替え手順を実施し、ドライバと CUDA バージョンの整合を確認してください。CPU に戻す場合:

```bash
pnpm run runtime:cleanup -w @modular-prompt/driver pytorch -- --yes
pnpm run setup-pytorch -w @modular-prompt/driver
```

## Ollama

クロスプラットフォーム対応のローカルLLM実行環境。

### インストール

#### macOS / Linux

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### macOS (Homebrew)

```bash
brew install ollama
```

#### Windows

[ollama.com](https://ollama.com)から Windows版をダウンロードしてインストール。

### サービスの起動

#### macOS (Homebrewでインストールした場合)

```bash
# サービス起動
brew services start ollama
```

#### その他

```bash
# フォアグラウンドで起動
ollama serve
```

#### 起動確認

```bash
# APIが応答するか確認
curl http://localhost:11434/api/tags

# または
ollama list
```

### モデルのダウンロード

Ollamaでモデルを使用するには、事前にダウンロードが必要です：

```bash
# モデルのダウンロード
ollama pull <model-name>

# 例: Llama 3.2のダウンロード
ollama pull llama3.2
```

#### ダウンロード状況の確認

```bash
# ダウンロード済みモデル一覧
ollama list
```

**出力例：**

```
NAME              ID              SIZE    MODIFIED
llama3.2:latest   a80c4f17acd5    2.0 GB  2 hours ago
gemma2:2b         8ccf136fdd52    1.6 GB  1 day ago
```

利用可能なモデルの完全なリストは [ollama.com/library](https://ollama.com/library) を参照してください。

### トラブルシューティング (Ollama)

#### サービスが起動しない

```bash
# プロセスを確認
ps aux | grep ollama

# ポート11434が使用中か確認
lsof -i :11434

# 既存のプロセスを終了して再起動
pkill ollama
ollama serve
```

#### モデルのダウンロードが遅い

ネットワーク接続を確認してください。モデルサイズに応じて、数分から数十分かかる場合があります。

#### メモリ不足

Ollamaはモデルをメモリに読み込むため、モデルサイズの1.5〜2倍のRAMが推奨されます。

## vLLM (CUDA GPU)

CUDA GPU環境（Linux）専用の高速LLM推論エンジン。

### 環境要件

- **ハードウェア**: NVIDIA CUDA対応GPU
- **OS**: Linux（CUDA環境）
- **Python**: 3.10以上（3.14未満）
- **uv**: Pythonパッケージマネージャー

### 初回セットアップ

vLLMドライバーのPython環境をセットアップします：

```bash
cd node_modules/@modular-prompt/driver/src/vllm/python
uv sync
```

**セットアップ内容：**

1. Python仮想環境の作成
2. vLLM関連パッケージのインストール（vLLM >= 0.8.0、transformers >= 4.45）

**注意：**
- vLLMはCUDA GPU環境（Linux）でのみ動作します
- Apple SiliconやWindowsでは使用できません

### エンジンの起動

vLLMエンジンはTypeScriptドライバーとは独立して起動します。Unix ドメインソケットを通じて通信します。

#### 基本的な起動

```bash
uv --project node_modules/@modular-prompt/driver/src/vllm/python run python __main__.py \
  --model Qwen/Qwen2.5-7B-Instruct \
  --socket /tmp/vllm.sock
```

#### ツールコール対応モデルの起動

```bash
uv --project node_modules/@modular-prompt/driver/src/vllm/python run python __main__.py \
  --model Qwen/Qwen2.5-7B-Instruct \
  --socket /tmp/vllm.sock \
  --tool-call-parser hermes
```

**利用可能なツールパーサー：**
- `hermes` - Hermes形式のツールコール
- `mistral` - Mistral形式のツールコール
- その他、vLLMのToolParserManagerがサポートするパーサー

#### オプション設定

```bash
uv --project ... run python __main__.py \
  --model <model-name> \
  --socket <socket-path> \
  --tool-call-parser <parser-name> \
  --gpu-memory-utilization 0.9 \
  --tensor-parallel-size 2 \
  --max-model-len 8192
```

**主要オプション：**
- `--model`: HuggingFace モデルID（必須）
- `--socket`: Unix ソケットパス（必須）
- `--tool-call-parser`: ツールコールパーサー名（オプション）
- `--gpu-memory-utilization`: GPU メモリ使用率（0.0-1.0）
- `--tensor-parallel-size`: テンソル並列サイズ
- `--max-model-len`: 最大モデル長（トークン数）

#### エンジンの動作確認

エンジンが正常に起動すると、次のメッセージが表示されます：

```
Loading model: Qwen/Qwen2.5-7B-Instruct
Model loaded: Qwen/Qwen2.5-7B-Instruct
Tool parser initialized: hermes
vLLM engine listening on /tmp/vllm.sock
```

### トラブルシューティング (vLLM)

#### CUDA環境が見つからない

```bash
# CUDA バージョン確認
nvidia-smi

# vLLM が CUDA を認識しているか確認
uv --project ... run python -c "import torch; print(torch.cuda.is_available())"
```

#### メモリ不足エラー

GPU メモリが不足している場合は、以下のオプションを調整してください：

```bash
# GPU メモリ使用率を下げる
--gpu-memory-utilization 0.7

# より小さいモデルを使用
--model mlx-community/gemma-2-2b-it-4bit
```

#### ソケット接続エラー

```bash
# ソケットファイルが残っている場合は削除
rm /tmp/vllm.sock

# エンジンを再起動
uv --project ... run python __main__.py ...
```

#### モデルのダウンロードが失敗する

初回起動時、HuggingFace Hubからモデルが自動的にダウンロードされます。ネットワーク接続を確認してください。

```bash
# キャッシュをクリア
rm -rf ~/.cache/huggingface/hub/

# 再度起動
uv --project ... run python __main__.py ...
```

## 使用例

### MLX

```typescript
import { MlxDriver } from '@modular-prompt/driver';

const driver = new MlxDriver({
  model: 'mlx-community/gemma-2-2b-it-4bit',
  defaultOptions: {
    max_tokens: 500,
    temperature: 0.7
  }
});

const result = await driver.query(prompt);
console.log(result.content);

await driver.close();
```

#### VLMモデルをtext-onlyモードで使用

VLM（Vision Language Model）対応モデルを画像なしのテキストのみで使用する場合は、`textOnly`フラグを使用します。

```typescript
const driver = new MlxDriver({
  model: 'mlx-community/Qwen2-VL-2B-Instruct-4bit',
  textOnly: true,  // VLMモデルをtext-onlyモードで起動
  defaultOptions: {
    max_tokens: 500,
    temperature: 0.7
  }
});

const result = await driver.query(prompt);
console.log(result.content);

await driver.close();
```

**`textOnly`フラグの用途:**
- VLM対応モデルを画像なしで使用したい場合
- VLMモデルの起動を高速化したい場合（`mlx-vlm`の代わりに`mlx-lm`で起動）
- VLMモデルでテキストのみのベンチマークを行う場合

### PyTorch

```typescript
import { PyTorchDriver } from '@modular-prompt/driver';

const driver = new PyTorchDriver({
  model: 'gpt2',
  defaultOptions: {
    maxTokens: 128,
    temperature: 0.7,
  },
});

const result = await driver.query(prompt);
console.log(result.content);

await driver.close();
```

事前に `pnpm run setup-pytorch -w @modular-prompt/driver` が必要です。

### Ollama

```typescript
import { OllamaDriver } from '@modular-prompt/driver';

const driver = new OllamaDriver({
  model: 'llama3.2',
  defaultOptions: {
    temperature: 0.7,
    maxTokens: 500
  }
});

const result = await driver.query(prompt);
console.log(result.content);
```

### vLLM

```typescript
import { VllmDriver } from '@modular-prompt/driver';

// エンジンを事前に起動しておく必要があります
// uv --project ... run python __main__.py --model Qwen/Qwen2.5-7B-Instruct --socket /tmp/vllm.sock

const driver = new VllmDriver({
  socketPath: '/tmp/vllm.sock',
  defaultOptions: {
    maxTokens: 500,
    temperature: 0.7
  }
});

const result = await driver.query(prompt);
console.log(result.content);

await driver.close();
```

### vLLM - ツールコール付き

```typescript
const driver = new VllmDriver({
  socketPath: '/tmp/vllm.sock'
});

const result = await driver.query(prompt, {
  tools: [
    {
      name: 'get_weather',
      description: 'Get weather information',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' }
        }
      }
    }
  ]
});

if (result.toolCalls) {
  console.log('Tool calls:', result.toolCalls);
}
```

## 関連ドキュメント

- [Driver APIリファレンス](./DRIVER_API.md)
- [packages/driver/README.md](../packages/driver/README.md)
- [Structured Outputs](./STRUCTURED_OUTPUTS.md)
