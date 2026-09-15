# ローカルモデルセットアップガイド

ローカル環境でAIモデルを実行するための完全ガイド。

## 目次

- [MLX (Apple Silicon)](#mlx-apple-silicon)
  - [環境要件](#環境要件)
  - [初回セットアップ](#初回セットアップ)
  - [モデル設定ファイル](#モデル設定ファイル)
  - [テスト用モデルのダウンロード](#テスト用モデルのダウンロード)
  - [任意のモデルのダウンロード](#任意のモデルのダウンロード)
  - [トラブルシューティング](#トラブルシューティング-mlx)
- [PyTorch (Transformers)](#pytorch-transformers)
  - [環境要件](#環境要件-pytorch)
  - [初回セットアップ](#初回セットアップ-pytorch)
  - [既存ユーザーからの移行](#既存ユーザーからの移行-pytorch)
  - [依存・runtime のカスタマイズ](#依存runtime-のカスタマイズ)
  - [カスタム index / 手動カスタマイズ](#カスタム-index--手動カスタマイズ-pytorch)
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
- **Python**: 3.13（`modular-prompt-runtime setup mlx` が venv を作成。手動構成では 3.11 以上でも可）
- **uv**: Pythonパッケージマネージャー（自動インストールされます）

### 初回セットアップ

MLX ドライバーを使うには、Python ランタイムを **明示的にセットアップ** します（`npm install` では自動セットアップされません）。

```bash
# monorepo ルートから
pnpm run setup-mlx

# @modular-prompt/driver を npm インストールした場合
modular-prompt-runtime setup mlx

# driver パッケージディレクトリから
cd node_modules/@modular-prompt/driver
pnpm run setup-mlx
```

`@modular-prompt/driver` を更新したあと（MLX Python 依存の変更を含む）は、同じコマンドで `~/.modular-prompt/runtimes/mlx/.venv` を再同期してください。

Python 環境は `~/.modular-prompt/runtimes/mlx/` に作成されます（プロジェクトや `node_modules` 内には作られません）。

**状態確認・掃除:**

```bash
pnpm --filter @modular-prompt/driver run runtime:status
pnpm --filter @modular-prompt/driver run runtime:cleanup mlx -- --yes
```

**セットアップ内容：**

1. uv パッケージマネージャーのインストール（未インストールの場合）
2. `~/.modular-prompt/runtimes/mlx/.venv` に Python 仮想環境を作成
3. MLX 関連パッケージのインストール

### モデル設定ファイル

通常利用のモデル alias は `~/.modular-prompt/models.yaml`、ローカル統合テスト用の alias は `~/.modular-prompt/models.testing.yaml` に分けて管理できます。別のディレクトリを使う場合は `MODULAR_PROMPT_HOME` を指定します。

#### 通常利用の設定

simple-chat や extract を `-m` なしで実行するには、通常利用用の `models.yaml` に `models.default` を明示します。次の最小設定を保存したあと、`simple-chat "こんにちは"` などの CLI 例を実行できます。

```bash
mkdir -p ~/.modular-prompt
cat > ~/.modular-prompt/models.yaml <<'YAML'
models:
  default:
    provider: mlx
    model: mlx-community/gemma-3-270m-it-4bit
YAML
```

`MODULAR_PROMPT_HOME` を設定している場合は、上記ファイルをそのディレクトリの `models.yaml` として作成してください。モデルを設定しない場合は、CLI の `-m <model-id-or-alias>` で明示的にモデルを指定します。

#### 統合テスト用の設定

`models.testing.yaml` は通常利用の設定とは別に、統合テストや testing profile で使うモデルを定義するためのファイルです。通常利用用の `models.yaml` の代わりにはなりません。

```bash
cp packages/driver/test/integration/models.testing.yaml.example \
  ~/.modular-prompt/models.testing.yaml
```

テスト実行時（Vitest または `NODE_ENV=test`）は `models.testing.yaml` が自動的にマージされます。extract や simple-chat を手元で testing モデルで実行する場合は、profile を明示します。

```bash
MODULAR_PROMPT_MODELS_PROFILE=testing modular-prompt-extract create meeting -m default docs/notes.txt
MODULAR_PROMPT_MODELS_PROFILE=testing simple-chat -m default "こんにちは"
```

マージ順は **base → `models.yaml` → `models.testing.yaml` → overlay** で、testing 側の同名 alias が通常設定を上書きします。認証情報は example に記載せず、環境変数またはローカルの `drivers` 設定で管理してください。

`models.testing.yaml.example` の `models.default` は MLX cache 統合テスト向けの text-only LM で、`driverOptions.backend: lm` を明示しています。MLX VLM は `driverOptions.backend: vlm`（または `auto`）でテキストのみの `exact_cache_v1` prompt cache と画像付きの `vision_cache_v1` prompt cache を別 namespace にディスク永続化できます。画像 cache と LM cache との相互利用、VLM incremental prefill は対応していません。

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
pnpm --filter @modular-prompt/driver run download-model
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

# MLX環境の再セットアップ（monorepo ルートから）
pnpm run setup-mlx
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

## PyTorch (Transformers)

Windows / Linux など **MLX が使えない環境**向けの Thin Python 推論ドライバ（Local Inference Protocol）。

- `cpu-minimal`: `torch` CPU wheel + `transformers` の最小構成
- `cuda`: CUDA 対応 `torch` wheel + `transformers`（デフォルトは CUDA 12.4 / `cu124`）
- 量子化や追加依存は下記「カスタム index / 手動カスタマイズ」で調整
- Linux + NVIDIA で本番寄りの推論が必要な場合は [vLLM](#vllm-cuda-gpu) を検討

### 環境要件 (PyTorch)

- **OS**: Windows / Linux / macOS（CUDA variant は NVIDIA ドライバーが使える Linux / Windows 向け。macOS では MLX を推奨）
- **Python**: 3.12（`setup-pytorch` が venv に使用）
- **uv**: パッケージマネージャー（未インストール時は自動インストール）

### 初回セットアップ (PyTorch)

```bash
# monorepo ルートから
pnpm run setup-pytorch

# 状態確認
pnpm --filter @modular-prompt/driver run runtime:status
```

Python プロジェクトは `~/.modular-prompt/runtimes/pytorch/python/` に、仮想環境は
`~/.modular-prompt/runtimes/pytorch/.venv` に作成されます。パッケージ内の
`src/pytorch/templates/cpu-minimal/` と `src/pytorch/templates/cuda/` は初回 seed 用の template であり、実行時には参照されません。

#### CUDA variant

NVIDIA GPU を使う場合は `cuda` variant を選択します。CUDA index のデフォルトは `cu124` です。

```bash
# monorepo ルートから
pnpm --filter @modular-prompt/driver run setup-pytorch -- --variant cuda

# CUDA 12.1 の wheel を選択する例
pnpm --filter @modular-prompt/driver run setup-pytorch -- --variant cuda --cuda 12.1

# @modular-prompt/driver を npm インストールした場合
modular-prompt-runtime setup pytorch --variant cuda --cuda 12.4
```

`--cuda 12.4` は PyTorch の `cu124` index に解決されます。`cu124` のような index 名も指定できます。
セットアップ時に NVIDIA GPU / ドライバーを検出できない場合も、警告を表示して続行します。実行前に
`runtime:status` の CUDA 状態を確認してください。

**セットアップ内容：**

1. `uv venv --python 3.12`
2. `torch==2.9.1` を variant に対応する index からインストール（CPU は CPU index、CUDA は `cu124` など）
3. `transformers` 等の依存を runtime 側プロジェクトからインストール

`runtime:status` は、インストール済み manifest の `variant` / `cudaVersion` / `torchVersion` と、CUDA variant の
`torch.cuda.is_available()` の結果を表示します。CUDA variant の既定 device は `cuda` です。CUDA が利用できない場合は、
推論開始時に NVIDIA ドライバーと CUDA 対応 torch wheel の確認を促すエラーになります。

### 既存ユーザーからの移行 (PyTorch)

既存の `~/.modular-prompt/runtimes/pytorch/`（venv のみ）を利用している場合は、
`setup-pytorch` を再実行してください。パッケージ内 template から runtime 側の
`python/` が seed され、以後は runtime 側の Python プロジェクトが実行に使われます。

monorepo では:

```bash
pnpm run setup-pytorch
```

npm パッケージ利用時は:

```bash
modular-prompt-runtime setup pytorch
# または、都度実行する場合
npx --package @modular-prompt/driver modular-prompt-runtime setup pytorch
```

パッケージを更新したあとに Python コードを反映する場合は、次の sync を実行します。
`setup --status` で driver バージョンの差分が表示された場合も同じコマンドを利用できます。

```bash
modular-prompt-runtime sync pytorch
```

monorepo では `pnpm --filter @modular-prompt/driver run runtime:sync-pytorch` を使えます。

### 依存・runtime のカスタマイズ

runtime 側の `pyproject.toml` はユーザーが編集できます。編集後に sync すると、
`pyproject.toml` を保持したまま Python コードを更新し、依存を再解決します。

```bash
vi ~/.modular-prompt/runtimes/pytorch/python/pyproject.toml
modular-prompt-runtime sync pytorch
```

`sync pytorch` は package 内 template のコード（`backends/`、`handlers/`、`__main__.py` など）を
runtime 側へ同期します。runtime 側の `pyproject.toml` と `uv.lock` は上書きされません。
template は package 更新で置き換わるため、依存設定や永続化したい変更は runtime 側を編集してください。

### カスタム index / 手動カスタマイズ (PyTorch)

自動セットアップが対応していない PyTorch index や torch バージョンを使う場合は、runtime 側の venv に手動で差し替えます。
自動セットアップ済みの CUDA variant を別の index に変更する場合にも利用できます。

#### torch の手動差し替え

```bash
PYTORCH_DIR=~/.modular-prompt/runtimes/pytorch
cd "$PYTORCH_DIR/python"

# 例: カスタム CUDA index（環境に合わせて index を選ぶ）
UV_PROJECT_ENVIRONMENT=$PYTORCH_DIR/.venv \
  uv pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu124

UV_PROJECT_ENVIRONMENT=$PYTORCH_DIR/.venv \
  uv run python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

[CUDA 対応表は PyTorch 公式](https://pytorch.org/get-started/locally/)を参照してください。

#### 外部 venv / conda の利用

外部 venv / conda を指定する場合も、先に `setup-pytorch` を一度実行して
`~/.modular-prompt/runtimes/pytorch/python/` を seed してください。実行時の Python
プロジェクトは常にこの runtime 側を使い、`venvPath`（または環境変数）だけを外部環境へ変更します。

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

依存を永続化する場合は、runtime 側の `pyproject.toml` に追加してから sync します。

```bash
vi ~/.modular-prompt/runtimes/pytorch/python/pyproject.toml
modular-prompt-runtime sync pytorch
```

モデル要件に応じてユーザーが選択する想定です。現行の CUDA template は `device_map` を使わず model を指定 device に移すため、
`accelerate` は標準依存に含めていません。必要なモデルで使う場合は runtime 側へ追加してください。

### トラブルシューティング (PyTorch)

#### runtime が見つからない

```bash
pnpm run setup-pytorch
```

#### CUDA が有効にならない

まず状態を確認します。

```bash
modular-prompt-runtime setup --status
```

`CUDA: unavailable` または `CUDA: unknown` の場合は、NVIDIA ドライバー、GPU の可視性、選択した
CUDA index の torch wheel を確認してください。CUDA 版 torch を別の index に差し替える必要がある場合は、
上記「カスタム index / 手動カスタマイズ」の手順を実施します。CPU に戻す場合:

```bash
pnpm --filter @modular-prompt/driver run runtime:cleanup pytorch -- --yes
pnpm run setup-pytorch
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

事前に `pnpm run setup-pytorch` が必要です。

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
