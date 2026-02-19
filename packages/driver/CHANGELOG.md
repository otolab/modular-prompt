# @modular-prompt/driver

## 0.6.0

### Minor Changes

- e0117fc: feat(driver): tools（Function Calling）サポートの追加

  全ドライバー（OpenAI, Anthropic, GoogleGenAI, VertexAI, Ollama）に tools/function calling 機能を追加。
  QueryOptions に tools/toolChoice、QueryResult に toolCalls を追加し、ストリーミング時の並列 tool calls 蓄積にも対応。

### Patch Changes

- Updated dependencies [d7c8e5c]
  - @modular-prompt/utils@0.2.1

## 0.5.2

### Patch Changes

- 50c66af: mlx-lm の最低バージョンを 0.30.4 に引き上げ

  GLM-4.7-Flash 等の`glm4_moe_lite`モデルタイプのサポートが mlx-lm 0.30.4 で追加されたため、pyproject.toml の依存バージョン制約を`>=0.28.3`から`>=0.30.4`に更新しました。

## 0.5.1

### Patch Changes

- 84ac5c8: mlx-lm の最低バージョンを 0.30.4 に引き上げ

  GLM-4.7-Flash 等の`glm4_moe_lite`モデルタイプのサポートが mlx-lm 0.30.4 で追加されたため、pyproject.toml の依存バージョン制約を`>=0.28.3`から`>=0.30.4`に更新しました。

## 0.5.0

### Minor Changes

- 9a7660e: ドライバーの defaultOptions を動的に変更可能にする getter/setter を追加

  全てのドライバー（OpenAI、Anthropic、VertexAI、GoogleGenAI、MLX）で defaultOptions プロパティに getter/setter を実装し、ドライバーインスタンス生成後に設定を動的に変更できるようにしました。これにより、ModelSpec.maxOutputTokens を使用して defaultOptions.maxTokens を設定するなどのユースケースが可能になります。

## 0.4.7

### Patch Changes

- Updated dependencies [2d9d217]
  - @modular-prompt/utils@0.2.0

## 0.4.6

### Patch Changes

- cac4dab: リネーム後のクリーンアップ

  - prepublishOnly スクリプトを修正（npm run → pnpm run）
  - リポジトリ URL を新しい名前に更新（moduler-prompt → modular-prompt）
  - experiment パッケージのビルド出力構造を修正（dist/src/ → dist/）
  - パッケージ説明文の修正

- Updated dependencies [cac4dab]
  - @modular-prompt/core@0.1.10
  - @modular-prompt/utils@0.1.5

## 0.4.5

### Patch Changes

- d85ab2d: MLX ドライバーの Python 環境セットアップを修正

  - Python 3.13 に固定（.python-version、setup-mlx.js、pyproject.toml）
  - 不要な test\_\*.py ファイルを削除
  - pyproject.toml に py-modules を明示的に指定して setuptools discovery 問題を解決

## 0.4.4

### Patch Changes

- Updated dependencies [afd3c40]
  - @modular-prompt/core@0.1.9
  - @modular-prompt/utils@0.1.4

## 0.4.3

### Patch Changes

- 9090829: GoogleGenAI driver improvements: Element to Parts/Content mapping and model update

  - Implement proper Element to Parts/Content conversion for Gemini API
  - Map instructions to systemInstruction (Part[]) and data to contents (Content[])
  - Add role conversion: assistant→model, system→user
  - Add integration tests for Element conversion
  - Update default model from gemini-2.0-flash-exp to gemma-3-27b for better stability

## 0.4.2

### Patch Changes

- b049930: package.json に repository フィールドを追加

  Trusted Publisher 使用時の--provenance フラグが repository.url を検証するため、
  driver と simple-chat パッケージに repository フィールドを追加しました。

## 0.4.1

### Patch Changes

- 80d2ec0: v0.4.0 の npm 公開

  - GoogleGenAI（Gemini）ドライバー機能を含む v0.4.0 を npm に公開
  - changeset ベースの自動リリースシステムを使用した最初のリリース
