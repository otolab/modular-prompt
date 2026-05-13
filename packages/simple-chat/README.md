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
# 使用するAIモデル
model: "mlx-community/gemma-3-270m-it-qat-4bit"

# ドライバータイプ（現在はmlxのみサポート）
driver: "mlx"

# VLMモデルをtext-onlyモードで使用（オプション）
textOnly: false  # trueにするとVLM対応モデルを画像なしで使用

# システムプロンプト - AIの基本的な振る舞いを定義
systemPrompt: |
  あなたは親切で知識豊富なAIアシスタントです。
  ユーザーの質問に対して、正確で分かりやすい回答を提供してください。
  日本語で応答してください。

# 初回メッセージ（オプション）- 新規セッション開始時の挨拶
preMessage: "こんにちは！何かお手伝いできることはありますか？"

# 参照ファイル（オプション）- プロンプトに含める追加資料
resourceFiles:
  - "./docs/guide.md"
  - "./data/reference.txt"

# 生成オプション
options:
  temperature: 0.7      # 生成の創造性（0.0-2.0）
  maxTokens: 4000      # 最大トークン数
  topP: 0.9            # トップP サンプリング
```

### デフォルトプロファイル

プロファイルを指定しない場合、以下のデフォルト設定が使用されます：

- **model**: mlx-community/gemma-3-270m-it-qat-4bit
- **systemPrompt**: 親切で知識豊富なAIアシスタントとしての基本設定
- **temperature**: 0.7
- **maxTokens**: 4000

### プロファイルの活用例

#### 1. 技術サポート用プロファイル

```yaml
model: "mlx-community/gemma-3-270m-it-qat-4bit"
systemPrompt: |
  あなたはソフトウェア開発の専門家です。
  技術的な質問に対して、具体的なコード例を交えて回答してください。
  エラーの解決方法を段階的に説明してください。
options:
  temperature: 0.3  # より正確な回答のため低めに設定
```

#### 3. VLMモデルで画像入力（Image-Text-to-Text）

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

#### 4. VLMモデルをテキストのみで使用

```yaml
model: "mlx-community/Qwen2-VL-2B-Instruct-4bit"
textOnly: true  # VLMモデルを画像なしで使用
systemPrompt: |
  あなたは親切で知識豊富なAIアシスタントです。
  テキストによる質問に回答してください。
options:
  temperature: 0.7
  maxTokens: 4000
```

#### 5. 創作支援用プロファイル

```yaml
model: "mlx-community/gemma-3-270m-it-qat-4bit"  
systemPrompt: |
  あなたは創造的な文章作成を支援するアシスタントです。
  ユーザーのアイデアを発展させ、独創的な提案を行ってください。
options:
  temperature: 1.2  # 創造性を高めるため高めに設定
  maxTokens: 8000  # 長い文章生成に対応
```

## 実装のポイント

このサンプル実装では、Moduler Promptフレームワークの主要な機能を実際のアプリケーションで活用する方法を示しています：

1. **静的なモジュール定義**: `chatPromptModule`は静的に定義されたテンプレート
2. **モジュールの合成**: `@modular-prompt/process`の`withMaterials`モジュールとの合成
3. **型安全なコンテキスト**: `ChatContext`による型定義
4. **段階的なデータバインディング**: createContext → データ設定 → compile

詳細は[プロンプトモジュール仕様書](../../docs/PROMPT_MODULE_SPECIFICATION.md)の実装例セクションを参照してください。