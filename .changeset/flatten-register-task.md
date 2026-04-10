---
"@modular-prompt/process": patch
"@modular-prompt/driver": patch
"@modular-prompt/experiment": patch
---

fix: __register_tasks を __register_task に単数化し、Gemma4 tool call対応を追加

- `__register_tasks`（配列）を`__register_task`（単一）にフラット化。モデルが複数回tool callすることで複数タスクを登録する方式に変更
- Gemma4形式のtool callパーサーを追加（`call:fn{key:value}` 形式）
- VLMパスの未定義関数`get_tool_stop_token_ids`参照を修正
- `AgenticWorkflowOptions.tools`の型を`ToolSpec[]`から`ToolDefinition[]`に変更
- 実験フレームワークで`queryOptions.tools`を`processOptions.tools`に渡すよう修正
