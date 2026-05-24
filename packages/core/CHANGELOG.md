# @modular-prompt/core

## 0.3.0

### Minor Changes

- 3f065b8: Element に cacheHint プロパティを追加。コンパイル時に DynamicContent 由来の要素を'contextual'、静的定義の要素を'static'として分類し、ドライバー層での KV キャッシュ最適化を可能にする。
- 0687267: CacheHint に'immutable'値を追加。DynamicContent 出力の既存 cacheHint を compile()が尊重するように変更。MlxCacheController を外部注入パターンに統一し、キャッシュディレクトリの外部指定に対応。simple-chat プロファイルから cacheDir と logPath で設定可能に。会話履歴メッセージに immutable ヒントを付与しキャッシュ対象に。

  インクリメンタル KV キャッシュを実装。cache_prefill が base_cache_path を受け取り、既存キャッシュをロードして差分トークンのみ処理。セッション内は lastHandle、cross-session は cache-index.json による prefix match で base cache を自動探索。

  element_char_offsets によるインクリメンタル trim。mergeSystemMessages 後のインデックスずれを文字オフセット+共有プレフィクス比較で解決し、既存キャッシュの部分再利用に対応。

  キャッシュゲート緩和。nativeTools と reasoningEffort の制約を撤廃し、ツール名ハッシュと reasoningEffort をキャッシュキーに含める方式に変更。ツール定義を cachePrefill IPC パイプラインに通す。

  ストリームメタデータによる統計改善。Python→TS の**META**プロトコルで prompt_tokens を伝搬し、ドライバとキャッシュコントローラの連携で正確なトークン統計を集計。PromptCacheController に recordQuery()を追加し、全クエリ数とキャッシュ利用数を区別。

  STANDARD_SECTIONS の data 順序を immutable→volatile 順に変更し、KV キャッシュプレフィックス一致長を最大化。

  VLM backend: drafter loading を batch_generate から stream_generate ベースに統一。

### Patch Changes

- aaa5d19: element_char_offsets によるインクリメンタル trim、キャッシュゲート緩和（ツール・reasoningEffort 対応）、ストリームメタデータによる統計改善、STANDARD_SECTIONS の data 順序最適化、VLM backend drafter loading 修正。

## 0.2.2

### Patch Changes

- af55885: 全パッケージの依存バージョンを固定（^ を除去し == に統一）。Python 依存（mlx-driver, vllm-driver）も同様に固定。

## 0.2.1

### Patch Changes

- 47b9eda: PromptModule に persona セクション追加、agentic workflow に state 伝播と\_\_update_state ツール追加

## 0.2.0

### Minor Changes

- 749e29e: agentic workflow の改善: タスクベース・tool calling 方式への再設計、プロンプト品質向上、insertAt 順序修正

## 0.1.13

### Patch Changes

- 64ab1f7: chore: npm パッケージに skills を同梱する仕組みを追加

  prepublishOnly 時に skills/<skill-name>/SKILL.md をパッケージ内にコピーし、npm パッケージに含めるようにした。

  - core: skills/prompt-writing/SKILL.md
  - driver: skills/driver-usage/SKILL.md
  - experiment: skills/experiment/SKILL.md

## 0.1.12

### Patch Changes

- 1c8c8db: feat(core,driver): ToolCall/ToolResult 型を中間フォーマットに移行 (#109)

  ToolCall/ToolResult 型を OpenAI API ロックインからプロバイダー非依存の中間フォーマットに移行。

  - ToolCall: `type: 'function'`廃止、`function`ネスト廃止、`arguments`をオブジェクト化、`metadata`追加
  - ToolResult: `content: string` → `kind`(`text`/`data`/`error`) + `value`に分離
  - ToolDefinition/ToolChoice: フラット化
  - 全ドライバー（OpenAI, Anthropic, GoogleGenAI, VertexAI）のアダプター変換を実装

## 0.1.11

### Patch Changes

- 835a9b9: feat(core): ToolCall 型を追加し MessageElement を Union 型に拡張

  ToolCall 型を core に定義し、MessageElement を StandardMessageElement | ToolResultMessageElement の Union 型に変更。tools 会話ループのメッセージを Element 経由で表現可能にした。

## 0.1.10

### Patch Changes

- cac4dab: リネーム後のクリーンアップ

  - prepublishOnly スクリプトを修正（npm run → pnpm run）
  - リポジトリ URL を新しい名前に更新（moduler-prompt → modular-prompt）
  - experiment パッケージのビルド出力構造を修正（dist/src/ → dist/）
  - パッケージ説明文の修正

## 0.1.9

### Patch Changes

- afd3c40: fix: Element-only セクションで標準セクションタイトルが表示されない問題を修正

  MessageElement、MaterialElement、ChunkElement などの Element のみで構成されるセクションにおいて、標準セクションタイトルを持つ SectionElement が作成されない問題を修正しました。

  これにより、messages、materials、chunks などのセクションが Element のみで構成されている場合でも、正しくセクションタイトルが表示されるようになります。

  また、schema セクションの JSONElement 抽出処理を改善し、JSONElement のみの場合は空の SectionElement が作成されないようにしました。
