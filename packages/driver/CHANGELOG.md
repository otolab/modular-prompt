# @modular-prompt/driver

## 0.11.0

### Minor Changes

- d5d80cc: QueryResult に `logEntries` / `errors` フィールドを追加し、クエリ実行中のログ・エラー情報を構造化して caller に返却するよう変更。

  - `QueryLogger` ヘルパーを新規追加（クエリスコープのログ収集）
  - 全ドライバー（OpenAI, Anthropic, VertexAI, GoogleGenAI, MLX, vLLM）で Logger を統一
  - `console.error` / `console.warn` の直接使用を全廃止
  - `@modular-prompt/utils` から `LogEntry` 型をエクスポート

### Patch Changes

- Updated dependencies [d5d80cc]
  - @modular-prompt/utils@0.3.3

## 0.10.6

### Patch Changes

- af55885: 全パッケージの依存バージョンを固定（^ を除去し == に統一）。Python 依存（mlx-driver, vllm-driver）も同様に固定。
- f003192: VertexAI ドライバーで JSON Schema の `type: ['string', 'null']` 形式（nullable 表現）を `nullable: true` に変換するよう修正。
- Updated dependencies [af55885]
  - @modular-prompt/core@0.2.2
  - @modular-prompt/utils@0.3.2

## 0.10.5

### Patch Changes

- 17f3a50: formatToolDefinitionsAsText のプロンプト改善: 非ネイティブ tool 対応モデル向けに tool call の意味を説明する文言を追加し、具体的なツール名・引数名を使った例示に変更

## 0.10.4

### Patch Changes

- d6742ee: VertexAI ドライバーで未サポートの JSON Schema フィールド（propertyNames 等）をサニタイズして除去するように修正

## 0.10.3

### Patch Changes

- c7cf2dc: AnthropicDriver の VertexAI 対応を@anthropic-ai/vertex-sdk に切り替え、ADC によるトークン自動取得をサポート

## 0.10.2

### Patch Changes

- c2ba74f: AnthropicDriver に VertexAI 経由での Claude 利用をサポートする vertex オプションを追加
- afe7be5: vLLM ドライバーの追加

  - AsyncLLMEngine を使用したローカル GPU 推論ドライバー
  - Python エンジンが Unix ドメインソケットで独立稼働、TypeScript が接続
  - vLLM ネイティブの ToolParserManager でツールコールパース

## 0.10.1

### Patch Changes

- Updated dependencies [47b9eda]
  - @modular-prompt/core@0.2.1
  - @modular-prompt/utils@0.3.1

## 0.10.0

### Minor Changes

- 749e29e: agentic workflow の改善: タスクベース・tool calling 方式への再設計、プロンプト品質向上、insertAt 順序修正

### Patch Changes

- 6d01df5: agentic-workflow の actions/ActionHandler を tool calling API に置き換え

  - ToolSpec 型（ToolDefinition + handler）を導入
  - execution フェーズに tool calling loop を実装
  - agent-workflow（簡易版）を削除
  - TestDriver に toolCalls サポート追加
  - experiment dynamic-loader の.ts モジュールファイル対応

- Updated dependencies [749e29e]
  - @modular-prompt/core@0.2.0
  - @modular-prompt/utils@0.3.0

## 0.9.3

### Patch Changes

- a732958: ハイフンを含む関数名のツールコールパースに対応

  - qwen3_coder 形式の関数名正規表現 `[\w.]+` を `[\w.\-]+` に修正
  - `mcp__coeiro-operator__operator_status` のような関数名が正しくパースされるように

## 0.9.2

### Patch Changes

- b57fcec: tool_call 終了タグの正規表現バグを修正

  - `detect_tool_call_format`の終了タグ検出パターンが開始タグにもマッチしていた問題を修正
  - Qwen3.5 等の`tool_parser_type`を持たないモデルでツールコールのパースが失敗していた
  - Qwen3.5 の改行を含む XML 形式出力のテストケースを追加

- 708f42c: VLM モデルで tools/primer が無視される問題を修正

  - handle_chat_vlm に tools・primer パラメータを追加
  - apply_chat_template への tools 渡し（TypeError フォールバック付き）
  - primer 処理を handle_chat と同じパターンで実装

## 0.9.1

### Patch Changes

- fbf6055: VLM モデルで画像なしリクエスト時の make_sampler エラーを修正

  - VLM モデルでも画像なしの場合に常に VLM 用生成パスを使用するよう修正
  - 画像が空の場合は image=None を渡すよう修正

## 0.9.0

### Minor Changes

- d78df1b: MLX ドライバーで mlx-vlm に対応

  - ChatMessage.content を string | Attachment[]に拡張（全ドライバー共通）
  - contentToString/extractImagePaths 共通ユーティリティ追加
  - model_type 動的 import による VLM/LM 自動判定
  - VLM ストリーミング生成（mlx_vlm.stream_generate）
  - 画像自動リサイズ（maxImageSize、デフォルト 768px）

- 9d23d3f: QueryOptions に mode プロパティを追加

  - クエリ実行モード（default/thinking/instruct/chat）をドライバー非依存で指定可能に
  - Anthropic: thinking オプションと組み合わせて Extended Thinking を有効化
  - OpenAI: reasoningEffort オプションと組み合わせて reasoning を有効化
  - Google GenAI: mode=thinking で thinkingConfig を自動適用
  - MLX: instruct/chat で API 選択に反映

## 0.8.2

### Patch Changes

- 23886fc: MLX ドライバのツールサポート検出・パース改善

  - KNOWN_TOOL_PARSERS 逆引きテーブルによる tool_parser_type 対応（9 種類）
  - special tokens 検出の命名規則拡張（\_start/\_end、XML 形式等）
  - hasNativeToolSupport()のマルチシグナル判定
  - parseToolCalls()の複数パーサー形式対応
  - formatToolDefinitionsAsText()のパラメータ簡潔化

## 0.8.1

### Patch Changes

- 64ab1f7: chore: npm パッケージに skills を同梱する仕組みを追加

  prepublishOnly 時に skills/<skill-name>/SKILL.md をパッケージ内にコピーし、npm パッケージに含めるようにした。

  - core: skills/prompt-writing/SKILL.md
  - driver: skills/driver-usage/SKILL.md
  - experiment: skills/experiment/SKILL.md

- 2fb9371: feat(driver): MLX ドライバのログ出力を Logger 統合 (#121)

  MLX ドライバ内の console.\*を@modular-prompt/utils の Logger に置き換え。
  Logger のグローバルレベル設定で Python プロセスの stderr 出力も制御可能に。

- 9831ef7: feat(driver): DriverRegistry の Logger をグローバルレベル制御に統一 (#123)

  DriverRegistry の Logger からインスタンスレベル設定を除去。
  Logger.configure()によるグローバルなログレベル制御が効くようになった。

- Updated dependencies [64ab1f7]
  - @modular-prompt/core@0.1.13
  - @modular-prompt/utils@0.2.4

## 0.8.0

### Minor Changes

- be3037c: feat(driver,experiment): MLXDriver の tools 対応 (#90)

  MLXDriver で Function Calling(tools)を使えるようにした。

  - native tools 対応モデル(Qwen3 等): apply_chat_template で注入
  - 非対応モデル(Gemma3 等): テキストフォールバック
  - tokenizer_config.json から tool_call_format を自動検出
  - experiment フレームワークに queryOptions(tools)対応を追加

## 0.7.0

### Minor Changes

- 68c1ead: feat(driver,experiment): MLXDriver の tools 対応 (#90)

  MLXDriver で Function Calling(tools)を使えるようにした。

  - native tools 対応モデル(Qwen3 等): apply_chat_template で注入
  - 非対応モデル(Gemma3 等): テキストフォールバック
  - tokenizer_config.json から tool_call_format を自動検出
  - experiment フレームワークに queryOptions(tools)対応を追加

## 0.6.3

### Patch Changes

- 866051c: fix(driver): ModelSpec.enabled を disabled に変更し、AIService.selectModels() で無効モデルを除外

  ModelSpec.enabled フラグを disabled に変更。デフォルトで有効、明示的に `disabled: true` で無効化するシンプルな設計に統一。AIService.selectModels() に disabled チェックを追加し、無効モデルが選択されない問題を修正。(#88)

- 1c8c8db: feat(core,driver): ToolCall/ToolResult 型を中間フォーマットに移行 (#109)

  ToolCall/ToolResult 型を OpenAI API ロックインからプロバイダー非依存の中間フォーマットに移行。

  - ToolCall: `type: 'function'`廃止、`function`ネスト廃止、`arguments`をオブジェクト化、`metadata`追加
  - ToolResult: `content: string` → `kind`(`text`/`data`/`error`) + `value`に分離
  - ToolDefinition/ToolChoice: フラット化
  - 全ドライバー（OpenAI, Anthropic, GoogleGenAI, VertexAI）のアダプター変換を実装

- Updated dependencies [1c8c8db]
  - @modular-prompt/core@0.1.12
  - @modular-prompt/utils@0.2.3

## 0.6.2

### Patch Changes

- Updated dependencies [835a9b9]
  - @modular-prompt/core@0.1.11
  - @modular-prompt/utils@0.2.2

## 0.6.1

### Patch Changes

- f17538c: fix(driver): ChatMessage に tool call/tool result の表現力を追加

  ChatMessage を Union 型に拡張し、QueryOptions.messages で tools 会話ループを実現可能にした。

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
