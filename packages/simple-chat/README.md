# Simple Chat - サンプル実装

Moduler Promptフレームワークを使用したチャットアプリケーションのサンプル実装です。実際のアプリケーションでフレームワークをどのように使用するかを示すリファレンス実装として提供されています。

## 概要

このパッケージは以下を実演します：
- PromptModuleの静的定義とコンテキストバインディング
- `merge`を使用したモジュール合成（`withMaterials`の活用）
- MLXドライバーを使用したAIモデルとの対話
- チャットログの管理とリソースファイルの処理

## インストール

```bash
npm install @modular-prompt/simple-chat
```

## 初回セットアップ（MLX）

simple-chat のデフォルトは MLX ローカル推論です。初回利用前に Python ランタイムの**明示的なセットアップ**が必要です（`npm install` では自動実行されません）。

Python 環境はマシン共有の `~/.modular-prompt/runtimes/mlx/` に作成されます（プロジェクトや `node_modules` 内には作られません）。

**前提条件**: macOS（Apple Silicon）、Python 3.13、uv（未インストール時はセットアップ中に自動インストール）

### monorepo から利用する場合

```bash
# リポジトリルートから
pnpm run setup-mlx

# または workspace 指定
pnpm run setup-mlx -w @modular-prompt/driver
```

### 公開パッケージとして利用する場合

```bash
node node_modules/@modular-prompt/driver/scripts/runtime-cli.js setup mlx
```

### 状態確認

```bash
# simple-chat CLI
simple-chat --check

# driver の runtime CLI
node node_modules/@modular-prompt/driver/scripts/runtime-cli.js setup --status
```

詳細は [@modular-prompt/driver README](../driver/README.md) および [ローカルモデルセットアップガイド](../../docs/LOCAL_MODEL_SETUP.md) を参照してください。

## 使用方法

### CLIとして使用

```bash
# 直接メッセージを送信
simple-chat "こんにちは"

# プロファイルを指定
simple-chat -p profile.yaml "質問があります"

# チャットログを保存・継続
simple-chat -l chat.json "会話を続けます"

# 標準入力から読み込み
echo "長い質問文..." | simple-chat --stdin

# オプションの組み合わせ
simple-chat -p custom.yaml -l session.json --temperature 0.8 "創造的な回答をお願いします"

# VLMモデルをtext-onlyモードで使用
simple-chat --model mlx-community/Qwen2-VL-2B-Instruct-4bit --text-only "こんにちは"

# VLMモデルで画像入力（Image-Text-to-Text）
simple-chat --model mlx-community/Qwen2-VL-2B-Instruct-4bit -i photo.jpg "この画像について説明して"

# 複数画像を入力
simple-chat --model mlx-community/Qwen2-VL-2B-Instruct-4bit -i img1.jpg -i img2.jpg "これらの画像を比較して"
```

### ライブラリとして使用

```typescript
import { chatPromptModule, performAIChat } from '@modular-prompt/simple-chat';
```

## 対話プロファイル

対話プロファイルは、チャットの動作を制御するYAML形式の設定ファイルです。

### プロファイルの構造

```yaml
# PromptModule の定義。systemPrompt ではなく module を使用します。
module:
  objective:
    - チャットアシスタントとして、ユーザーの質問に回答する
  instructions:
    - 日本語で自然に応答する
    - 不確実な情報は不確実であると明確に伝える

# モデルは直接指定することも、models.yaml の alias を参照することもできます。
workflow:
  mode: direct
  models:
    default:
      ref: local-chat

# ~/.modular-prompt/models.yaml への inline overlay（必要な場合のみ）
modelsConfig:
  mode: merge
  models:
    local-chat:
      provider: mlx
      model: mlx-community/gemma-3-270m-it-qat-4bit

# VLMモデルをtext-onlyモードで使用（オプション）
textOnly: false

# 初回メッセージ（オプション）- 新規セッション開始時の挨拶
preMessage: "こんにちは！何かお手伝いできることはありますか？"

# 参照ファイル（オプション）- プロンプトに含める追加資料
resourceFiles:
  - "./docs/guide.md"
  - "./data/reference.txt"

# 生成オプション
options:
  temperature: 0.7
  maxTokens: 4000
  topP: 0.9

# KVキャッシュ（MLX専用、オプション）
cacheDir: ".cache/mlx-kv"

# チャットログ（オプション）
logPath: "./chat.log.json"
```

### デフォルトプロファイル

`-p` でプロファイルを指定しない場合、`loadDefaultProfile()` が次の設定をコードから生成します。リポジトリにあった `default-profile.yaml` は実行時には読み込みません。

- **`module.objective`**: 最新のユーザーメッセージに対する返答を作成
- **`module.instructions`**: 自然な日本語の対話とコンテキスト理解を重視
- **`options.temperature`**: 1.0
- **`options.maxTokens`**: 4000
- **`options.topP`**: 0.95

モデルはデフォルトプロファイルに固定せず、次の順序で解決されます。

1. CLI `--model`（`-m`）— 最優先の実行時 override
2. プロファイルの `model`（alias または生の model 名）
3. `workflow.models.default`（`ref` または `provider` + `model`）
4. マージ済み `models.yaml` の `models.default` alias（同梱設定 → ユーザー設定 → プロファイル overlay の順でマージ）

### models.yaml との統合

simple-chat は **デフォルトで `merge` モード**です。`~/.modular-prompt/models.yaml`（`MODULAR_PROMPT_HOME` で変更可）の alias 定義をマージして利用します。同梱の `BUNDLED_MODELS_CONFIG` がベースとなり、ユーザー yaml で alias を追加・上書きできます。

- **`modelsConfig.mode: merge`**（既定）— ユーザー yaml をマージ。マシン共通の alias を共有しつつ、プロファイル overlay で上書き可能
- **`modelsConfig.mode: override`** — ユーザー yaml を無視し、同梱設定 + プロファイル overlay のみ使用

プロファイルの `modelsConfig` は上記マージへの明示的な overlay です。`workflow.models.default.ref` で alias を参照できます。

`module` はチャット基盤の PromptModule と合成されるため、基盤側の日本語応答指示も含まれます。

### プロファイルの活用例

#### 1. 技術サポート用プロファイル

```yaml
module:
  objective:
    - ソフトウェア開発の専門家として技術的な質問に回答する
  instructions:
    - 具体的なコード例を交えて説明する
    - エラーの解決方法を段階的に説明する
options:
  temperature: 0.3
```

#### 2. VLMモデルで画像入力（Image-Text-to-Text）

```yaml
model: "mlx-community/Qwen2-VL-2B-Instruct-4bit"
module:
  objective:
    - 画像の内容を分析し、ユーザーの質問に回答する
options:
  temperature: 0.7
  maxTokens: 4000
```

CLIで画像ファイルを指定して使用します：

```bash
# 単一画像
simple-chat -p vlm-profile.yaml -i photo.jpg "この画像に何が写っていますか？"

# 複数画像
simple-chat -p vlm-profile.yaml -i before.jpg -i after.jpg "変更点を教えて"

# チャットログで会話を継続（画像情報もログに保存されます）
simple-chat -p vlm-profile.yaml -l session.json -i diagram.png "この図の説明をお願いします"
```

VLMモデルは`config.json`の`model_type`から自動検出されます。画像は最大768pxにリサイズされて処理されます。

#### 3. VLMモデルをテキストのみで使用

```yaml
model: "mlx-community/Qwen2-VL-2B-Instruct-4bit"
textOnly: true
module:
  objective:
    - テキストによるユーザーの質問に回答する
options:
  temperature: 0.7
  maxTokens: 4000
```

#### 4. 創作支援用プロファイル

```yaml
module:
  objective:
    - 創造的な文章作成を支援する
  instructions:
    - ユーザーのアイデアを発展させる
    - 独創的な提案を行う
options:
  temperature: 1.2
  maxTokens: 8000
```

### KVキャッシュの活用（MLX専用）

`cacheDir`を指定すると、プロンプトの静的部分（システムプロンプト、会話履歴、資料など）のKV状態をファイルに保存し、2回目以降の推論を高速化できます。

```yaml
cacheDir: ".cache/mlx-kv"  # キャッシュファイルの保存先
options:
  temperature: 0.7
  maxTokens: 4000
```

#### 特徴
- MLXドライバー専用（他のプロバイダーでは無視されます）
- 会話履歴や資料が多い場合に効果が大きい
- キャッシュファイル（.safetensors）は手動管理（`rm -rf <cacheDir>`でクリア）
- ディレクトリが存在しない場合は自動作成される

## 実装のポイント

このサンプル実装では、Moduler Promptフレームワークの主要な機能を実際のアプリケーションで活用する方法を示しています：

1. **静的なモジュール定義**: `chatPromptModule`は静的に定義されたテンプレート
2. **モジュールの合成**: `@modular-prompt/process`の`withMaterials`モジュールとの合成
3. **型安全なコンテキスト**: `ChatContext`による型定義
4. **段階的なデータバインディング**: createContext → データ設定 → compile

詳細は[プロンプトモジュール仕様書](../../docs/PROMPT_MODULE_SPEC.md)の実装例セクションを参照してください。
