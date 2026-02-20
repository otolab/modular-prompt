---
"@modular-prompt/core": patch
"@modular-prompt/driver": patch
---

feat(core,driver): ToolCall/ToolResult型を中間フォーマットに移行 (#109)

ToolCall/ToolResult型をOpenAI APIロックインからプロバイダー非依存の中間フォーマットに移行。
- ToolCall: `type: 'function'`廃止、`function`ネスト廃止、`arguments`をオブジェクト化、`metadata`追加
- ToolResult: `content: string` → `kind`(`text`/`data`/`error`) + `value`に分離
- ToolDefinition/ToolChoice: フラット化
- 全ドライバー（OpenAI, Anthropic, GoogleGenAI, VertexAI）のアダプター変換を実装
