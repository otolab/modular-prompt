# @modular-prompt/driver

## 0.15.0

### Minor Changes

- f0bf773: feat: Local Inference Protocol (LIP) 型定義を追加（Phase 1）

  Closes #307

- 48292f3: feat: LIP 通信層を InferenceProcessClient に抽出（Phase 2）

  Closes #309

- d5f532d: feat: LIP `generate` メソッドを追加し completion 経路を切替（Phase 3）

  Closes #311

- 2f886db: LIP Phase 4: `render` 分離と chat 暗黙整形の廃止

  - Python `render` ハンドラ追加（`apply_chat_template` のみ）
  - TS chat 経路を `render` + `generate` の 2 段に変更
  - `generate_merged_prompt` を TS `generateMergedPrompt` に移行
  - Python `chat` ハンドラ廃止、`generate` に KV キャッシュ・primer 対応を統合

- f1288ab: LIP Phase 5: LocalInferenceDriver 抽出

  - `local-inference/driver.ts` に共通 AIDriver 骨格を新設
  - `MlxDriver` を MLX 固有設定の薄いラッパにリファクタ
  - ストリーム META 処理を `stream-utils.ts` に分離

- 30c4143: LIP Phase 6: PyTorch バックエンド（cpu-minimal runtime）

  - `PyTorchDriver` / `PyTorchProcess` を追加（`LocalInferenceDriver` 上に実装）
  - `setup-pytorch` で CPU 最小 venv を `~/.modular-prompt/runtimes/pytorch/` に作成
  - Transformers LM バックエンド（`packages/driver/src/pytorch/python`）
  - 手動 CUDA / 外部 venv のドキュメントを `docs/LOCAL_MODEL_SETUP.md` に追加

- 30ba3fc: refactor: models.yaml の defaults/runtime 解決を廃止し model 先行のモデル選択に統一

  **破壊的変更（driver）**

  - `ModelsConfig.defaults` と `resolveDefaultModel()` を削除
  - `resolveModelReference({ runtime })` 経路を削除
  - `resolveDefaultModelFromConfig()` / `resolveModelName()` を追加（`models.default` alias または先頭エントリから導出）
  - `ModelsConfigSource`（`merge` | `overlay`）を追加。`overlay` は user `models.yaml` を無視
  - `AIService.fromModelsConfig()` / `fromOverlay()` / `fromMergedConfig()` ファクトリを追加

  **simple-chat**

  - `AIService` 経由でドライバ作成。bundled models + user + profile を merge
  - `-m` / `profile.model` は alias 解決後に生 model 名として使用
  - `textOnly` / `--text-only` に deprecated warning
  - `inference-selection` の `mlxBackend: 'auto'` 暗黙付与を廃止

  Closes #341

- e0e6611: feat: MLX Python ランタイムを `~/.modular-prompt/` に分離し、postinstall 自動セットアップを廃止

  Closes #303

- 235af29: simple-chat に `--provider` / `--backend` を追加。ModelSpec にも `backend` フィールドを追加し、MLX 実行モード（auto/lm/vlm/optiq）を provider と分離して統一。
- be002b8: feat: ユーザーレベル `models.yaml` と overlay によるモデル解決（利用者契約の仕様変更）

  `~/.modular-prompt/models.yaml`（`MODULAR_PROMPT_HOME` 可）からユーザ定義 models を読み込み、利用側が投入する overlay と **overlay > user** の優先順位で解決する。プロジェクト配下の暗黙探索は行わない。

  **利用側ツール向け（仕様上の注意）**

  - `resolveModelsConfig()` / `loadUserModelsConfig()` 利用時、overlay を渡さなくても **ユーザ設定が解決結果に混入しうる**
  - 既定の `mode: 'merge'` では user models がベースに残る。ツール独自定義のみにしたい場合は `mode: 'override'` 等の設計判断が必要
  - 利用者向けに「ホームディレクトリの `models.yaml` が影響する」ことを明記すること

  **driver**

  - `resolveModelsConfig` / `loadUserModelsConfig` / `mergeModelsConfig` / `resolveModelReference` / `registerModelsFromConfig` を追加
  - `merge`（浅いマージ）と `override`（models の置換）をサポート

  **simple-chat**

  - profile の `modelsConfig`（inline `models` / `defaults` / `drivers`）と `workflow.models.default.ref` をサポート

  Closes #304

### Patch Changes

- c3f3b67: chore: mlx-vlm を 0.6.3 → 0.6.4 に更新（mlx-lm 0.31.3 は PyPI 最新のため据え置き）
- 3569a1d: feat: ExtractSession に PromptCacheController 連携を追加（Phase 2）

  `createExtractSession` がセッション単位で KV キャッシュを prepare / release し、毎回のクエリに `cacheHandle` を渡す。driver 側は `QueryOptions.cacheHandle` で外部 prepare を利用可能。

  Closes #332

- ab4f2d0: fix: MLX ドライバーの QueryOptions 処理を一本化し mode の Python 漏れを修正

  `defaultOptions` を `Partial<MlxQueryOptions>` に統一。マージ後に `toMlxSamplingOptions` で
  サンプリングパラメータのみ Python 層へ渡す。Closes #298

- c20c6bc: runtime:status で PyTorch runtime の variant / torch バージョンを表示

  - `RuntimeManifest` 型に `variant` / `torchVersion` を追加
  - `collectInstalledPackages` が venv の Python を明示参照するよう修正

## 0.14.0

### Minor Changes

- a47efa9: feat: QueryOptions.signal と usage の cache 系フィールドを共通ドライバ API に追加（MLX で実装）

## 0.13.5

### Patch Changes

- e1977ba: chore: mlx-vlm を 0.5.0 → 0.6.3 に更新
- d2df6c3: fix: mlx-vlm に sys_platform == 'darwin' マーカーを追加

## 0.13.4

### Patch Changes

- 766447a: feat: キャッシュの read-only モードを追加

  `QueryOptions.cache`に`'read-only'`値を追加。既存キャッシュは使用するが、新規エントリの作成（increase）を行わないモード。

  ユースケース:

  - oneshot リクエストでキャッシュ書き込みを省略
  - 重要なキャッシュを supersedes 自動削除から保護

  simple-chat に`--cache`オプションを追加（`true`/`false`/`read-only`）。
  ルート package.json のスクリプトを`pnpm --filter`による子パッケージ移譲形式に統一。

## 0.13.3

### Patch Changes

- eae48db: fix: MlxDriver で QueryOptions.cache オプションを尊重するように修正。cache: false 指定時に KV キャッシュを迂回する。
- 0920f17: fix: outputSchema の挿入位置を Instructions セクションから Output セクションに移動。Output セクションヘッダーは preamble の"three main sections"宣言と一貫性を保つためデフォルトで常に出力されるように変更。alwaysIncludeOutputHeader: false で抑制可能。これにより MlxDriver の outputSchema 使用時のキャッシュ迂回ガードが不要になり、routing リクエスト等でもキャッシュが利用可能に。

## 0.13.2

### Patch Changes

- d15e70d: feat: CacheHandle に supersedes フィールドを追加。incremental プリフィル時に置き換え元キャッシュの ref を返すことで、呼び出し側での古いキャッシュ削除を可能にした。
- 41e8166: feat: cache-index.json のファイルロック機構を追加し、invalidate()を release()ヒント機構に置き換え。proper-lockfile によるアドバイザリロックで外部プロセスとの安全な共有を実現。release()はキャッシュの「もう要らない」ヒントを送るだけで、実際の削除は close()時またはキャッシュクリーンプロセスに委ねる設計に変更。
- a4af06a: refactor: tool-call-parser をモジュール構造に分割し、ContentParser インターフェースによるプラグイン構造を導入。MiniCPM5 XML フォーマット対応を含む。

## 0.13.1

### Patch Changes

- d1d029a: fix: computePrefixInfo で immutable Element 境界の prefix hash を追加

  section 境界のみだった prefix hash 計算に、最後の immutable Element の位置での hash を追加。
  チャット履歴の immutable メッセージ部分が incremental キャッシュで再利用されるようになり、
  prefill の reuse 率が大幅に向上する。

## 0.13.0

### Minor Changes

- bbe70b8: Anthropic ドライバーにプロンプトキャッシング（cache_control）サポートを追加。
  QueryOptions に`cache: true`を指定することで、静的なシステムプロンプトやメッセージ履歴に ephemeral キャッシュコントロールを適用。
- e7ef1cb: Google GenAI ドライバーにプロンプトキャッシング対応を追加。
  PromptCacheController インターフェースと GoogleGenAICacheController 実装を提供。
  Element 変換ロジックを element-converter.ts に抽出し、ドライバーと CacheController で共有。
- 16e5111: feat: @google/genai v2 アップグレード + Gemini 3 thoughtSignature 対応
- 0687267: CacheHint に'immutable'値を追加。DynamicContent 出力の既存 cacheHint を compile()が尊重するように変更。MlxCacheController を外部注入パターンに統一し、キャッシュディレクトリの外部指定に対応。simple-chat プロファイルから cacheDir と logPath で設定可能に。会話履歴メッセージに immutable ヒントを付与しキャッシュ対象に。

  インクリメンタル KV キャッシュを実装。cache_prefill が base_cache_path を受け取り、既存キャッシュをロードして差分トークンのみ処理。セッション内は lastHandle、cross-session は cache-index.json による prefix match で base cache を自動探索。

  element_char_offsets によるインクリメンタル trim。mergeSystemMessages 後のインデックスずれを文字オフセット+共有プレフィクス比較で解決し、既存キャッシュの部分再利用に対応。

  キャッシュゲート緩和。nativeTools と reasoningEffort の制約を撤廃し、ツール名ハッシュと reasoningEffort をキャッシュキーに含める方式に変更。ツール定義を cachePrefill IPC パイプラインに通す。

  ストリームメタデータによる統計改善。Python→TS の**META**プロトコルで prompt_tokens を伝搬し、ドライバとキャッシュコントローラの連携で正確なトークン統計を集計。PromptCacheController に recordQuery()を追加し、全クエリ数とキャッシュ利用数を区別。

  STANDARD_SECTIONS の data 順序を immutable→volatile 順に変更し、KV キャッシュプレフィックス一致長を最大化。

  VLM backend: drafter loading を batch_generate から stream_generate ベースに統一。

- 0bd3ef4: MLX ドライバーに PromptCacheController 対応を追加。PromptCacheController インターフェースを実装した MlxCacheController により、cacheable 要素の KV キャッシュプレフィルと再利用が可能に。
- bd0467f: MLX Python バックエンドのリファクタリング: ファイル分割・バックエンド抽象化・テスト追加。speculative decoding 用の drafterModel オプションを追加。
- d402ded: refactor: レスポンスプロセッサを capabilities 駆動に統合

  - selectResponseProcessor が常に ResponseProcessor を返すように変更（null 返却を廃止）
  - createDefaultProcessor ファクトリを追加（thinking 抽出 + ツールコール解析を合成）
  - Gemma-4 の`<|channel>thought...<channel|>`形式の thinking 抽出をサポート
  - mlx-driver の post-processing 分岐を統合（if/else → 一本道）
  - model-handlers.ts の内部関数 11 個を unexport 化（公開 API を整理）

### Patch Changes

- aaa5d19: element_char_offsets によるインクリメンタル trim、キャッシュゲート緩和（ツール・reasoningEffort 対応）、ストリームメタデータによる統計改善、STANDARD_SECTIONS の data 順序最適化、VLM backend drafter loading 修正。
- 2a5a092: fix: MLX Python プロセスの異常終了時にキュー内のリクエストを適切に reject する
- Updated dependencies [3f065b8]
- Updated dependencies [aaa5d19]
- Updated dependencies [0687267]
  - @modular-prompt/core@0.3.0
  - @modular-prompt/utils@0.3.5

## 0.12.0

### Minor Changes

- 341caa8: tool call 形式検出・パーサー選択の一元化と`<think>`タグ抽出のドライバー統合

  - tool call 形式検出を tool_call_format（Python 側検出結果）に一元化
  - hasNativeToolSupport()を簡素化（5 シグナル → tool_call_format.call_start のみ）
  - selectResponseProcessor を tool_parser_type ベースに変更
  - parseToolCalls から Harmony/context-1 重複パスを削除
  - Harmony レスポンスパーサーでストリーム出力（暗黙`<|start|>`省略）に対応
  - `<think>`タグ抽出を content-utils.extractThinkingContent()に統合し、QueryResult.thinkingContent で一本化
  - process/experiment の個別 stripThinkBlocks 処理を廃止

### Patch Changes

- 4f709f7: thinkingContent 伝播と MLX trustRemoteCode オプション追加

  - ドライバーが抽出した thinkingContent を全ワークフロー →WorkflowResult→RunResult まで伝播
  - MlxMlModelOptions に trustRemoteCode を追加（apply_chat_template でリモートコード実行を許可）
  - PARAMETER_CONSTRAINTS のホワイトリスト管理を明示化

## 0.11.15

### Patch Changes

- Updated dependencies [69d3cd1]
  - @modular-prompt/utils@0.3.4

## 0.11.14

### Patch Changes

- 6e8631b: fix: MLX プロセス通信のバグ修正と chat template 文字列の除去

  - capabilities JSON から未使用の template_string フィールドを除去（レスポンスサイズ削減）
  - handleJsonResponse と onRequestCompleted の二重呼び出しによる isProcessing フラグ不整合を修正
  - null 文字後のデータが消失するバグを修正（stdout バッファ結合時の対策）

## 0.11.13

### Patch Changes

- 50396a6: fix: **register_tasks を **register_task に単数化し、Gemma4 tool call 対応を追加

  - `__register_tasks`（配列）を`__register_task`（単一）にフラット化。モデルが複数回 tool call することで複数タスクを登録する方式に変更
  - Gemma4 形式の tool call パーサーを追加（`call:fn{key:value}` 形式）
  - VLM パスの未定義関数`get_tool_stop_token_ids`参照を修正
  - `AgenticWorkflowOptions.tools`の型を`ToolSpec[]`から`ToolDefinition[]`に変更
  - 実験フレームワークで`queryOptions.tools`を`processOptions.tools`に渡すよう修正

## 0.11.12

### Patch Changes

- 1797a1a: ModelSpec に driverOptions フィールドを追加。ドライバー固有オプション（MLX の textOnly / maxImageSize 等）を型安全に設定可能にした。

## 0.11.11

### Patch Changes

- 6af12cf: feat: Gemma-4 および llm-jp-4 のモデルハンドラーを追加

## 0.11.10

### Patch Changes

- 935934a: feat: QueryOptions に topK を追加し、MLX VLM モードで top_p/top_k サンプリングをサポート

## 0.11.9

### Patch Changes

- 07ed99e: feat: MLX ドライバーに textOnly オプションを追加し、VLM モデルをテキストのみで使用可能に

## 0.11.8

### Patch Changes

- 9470339: fix: MLX ドライバーの誤った tool call stop token 処理を削除し、native tool call が正しく検出されるよう修正

## 0.11.7

### Patch Changes

- 649ac0c: fix: compiledPromptToMessages が Element の出現順を保持するように修正
- 87afa13: fix: converter・MLX・vLLM ドライバーで toolCalls/toolResult メッセージを正しく処理

  formatPromptAsMessages の elementToMessages()が toolCalls と tool result メッセージを
  失っていた問題、および MLX・vLLM ドライバーの convertMessages()がこれらのメッセージを
  無視していた問題を修正。

## 0.11.6

### Patch Changes

- a13bf0c: fix: context-1 パーサーが `<|constrain|>` 等の特殊トークンを含む出力を正しくパースできない問題を修正

  - `parseContext1ToolCalls` の正規表現 `[^<]*` → `[\s\S]*?` に変更
  - `get_tool_stop_token_ids()` で `special_tokens.tool_call_end.id` を直接使用するように改善
  - stop token チェックで `response.token` を `int()` キャストして型安全性を確保

## 0.11.5

### Patch Changes

- 4588bf2: fix: context-1 モデルの tool_call_end 単体トークンによる tool call 検出対応

  - `hasNativeToolSupport()` で `tool_call_end` 単体トークンも認識するように修正
  - `get_tool_stop_token_ids()` で `special_tokens.tool_call_end` へのフォールバックを追加
  - `parseToolCalls()` で `tool_call_end` 特殊トークンから context-1 パーサーを起動するように修正

## 0.11.4

### Patch Changes

- 9a02d5e: feat: MLX completion API の VLM 画像対応インフラ追加

  - completion API に images/maxImageSize パラメータを追加し、VLM モデルで画像付き completion 推論を可能にする
  - apply_chat_template の判定をテンプレート設定有無まで確認するよう修正
  - VLM フォールバック用ダミー画像アセットを追加

- e35aab8: feat: MlxDriver の context-1 モデル tool call 対応

  - context-1 形式（`to=functions.{name}<|channel|>...<|message|>{json}<|call|>`）の検出・パースを追加
  - `tool_call_format.call_end` を汎用 stop token として使用する機構を追加（context-1 以外のモデルにも有効）

## 0.11.3

### Patch Changes

- 71c44dc: fix: Gemini API の複数 functionResponse を 1 つの user メッセージにまとめるように修正

  VertexAI / GoogleGenAI ドライバーで、複数の tool result（functionResponse）がそれぞれ個別の user メッセージに変換されていた問題を修正。Gemini API は 1 つの model メッセージ内の複数 functionCall に対応する functionResponse を、1 つの user メッセージにまとめる必要がある。

## 0.11.2

### Patch Changes

- 0f874ea: ApplicationConfig.defaultOptions と ModelSpec に mode (QueryMode) を追加。MLX/vLLM の defaultOptions 型も統一。MLX Python 依存を更新 (mlx 0.31.1, mlx-lm 0.31.1, mlx-vlm 0.4.3)。

## 0.11.1

### Patch Changes

- 507daea: fix: VertexAI ドライバで candidate.content.parts が undefined の場合のクラッシュを修正

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
