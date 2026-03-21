# MLXドライバー - Qwen系モデルの挙動

**調査日**: 2026-03-21
**対象**: MLXドライバー経由のローカルモデル（Qwen系）

## 概要

このドキュメントは、MLXドライバーを通じてQwen系モデルを使用する際の、tool call時のcontent挙動について記録します。

## Tool Call時のContent挙動

### 事実1: MLXドライバーのTool Call処理フロー

MLXドライバーは、モデルがネイティブでtool_useをサポートしていないため、以下のフローで処理します:

1. モデルはテキストとして構造化レスポンスを返す（ネイティブtool_useではない）
2. `parseToolCalls()` (`packages/driver/src/mlx-ml/tool-call-parser.ts`) がテキストからtool callパターンを検出・抽出
3. 抽出時、tool callデリミタ部分（例: `<tool_call>...</tool_call>`）をテキストから除去し、残りを `content` として返す
4. **地の文がデリミタの外にあれば content に保持される設計**

### 事実2: Chat Templateによる制約

Qwen系モデルのchat templateには、以下の動作があります:

- `tokenizer.apply_chat_template(messages, tools=tools, ...)` でHuggingFaceのJinja2テンプレートが適用される（`packages/driver/src/mlx-ml/python/__main__.py` 103行目）
- テンプレートがtools定義を受け取ると、以下の指示をシステムプロンプトに自動挿入する:
  - "If you choose to call a function ONLY reply in the following format with NO suffix"
  - "You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after"
- **この指示はドライバーのコードではなく、モデル同梱のJinja2テンプレートが生成している**

**結果**: tool call時にモデルは地の文を出力しないか、出力してもtool_callタグの前に限定される

### 事実3: 実行トレースでの確認

実行トレース (`/tmp/trace-test-20260316`, 2026-03-21実行) からの観測結果:

- **planning タスク**: `<think></think>` の後に `<tool_call>` → content は空
- **recall タスク** (`__time`呼び出し後の2回目クエリ): tool result を受けてテキスト応答 → content にテキストあり
- assistant ターンのcontent部分がMLX_process.logで `<|im_start|>assistant\n<|im_end|>` と空になっているケースがある

### 事実4: structuredOutput と content の関係

`QueryResult` の設計:

- `content` (string, 必須): 生テキストが常に保持される
- `structuredOutput` (unknown, オプショナル): content からJSON抽出した結果を追加格納
- **両者は排他ではなく両立する設計**
- この設計は全ドライバー共通（OpenAI, Anthropic, MLX）

### 事実5: Agentic Workflowでの影響

- `queryWithTools` は `result.content` のみを返し、`structuredOutput` は無視される
- tool call時にモデルがcontentを出力しない場合、タスク結果が空文字列になる
- 疑似thinkタグのplanningブロックが空になる原因

## 関連コード

- `packages/driver/src/mlx-ml/tool-call-parser.ts` — parseToolCalls(), parseWithDelimiters()
- `packages/driver/src/mlx-ml/mlx-driver.ts` — query(), streamQuery() 340-373行目
- `packages/driver/src/mlx-ml/python/__main__.py` — handle_chat() 103行目: apply_chat_template
- `packages/process/src/workflows/agentic-workflow/process/query-with-tools.ts` — queryWithTools() 113行目: content更新ロジック

## 結論と推奨事項

### 現象の原因

content が空になるのは**ドライバーのバグではなく**、モデルのchat templateが「tool call時はフォーマットのみで応答せよ」と指示しているためです。

### モデル固有性

モデルごとにchat templateの挙動が異なるため、以下の点に注意が必要です:

- Qwen系モデル: tool call時に地の文を出力しない傾向
- 他のモデル: chat templateの実装により挙動が異なる可能性

### ドライバー実装者への示唆

MLXドライバーを使用する際は、以下を考慮してください:

1. tool call時に `content` が空になる可能性がある
2. モデルの推論過程を取得したい場合、tool callの前に明示的にreasoning出力を求める必要がある
3. agentic workflowで疑似thinkタグを使用する場合、planning結果が空になる可能性を想定した設計が必要

## 更新履歴

- 2026-03-21: 初版作成
