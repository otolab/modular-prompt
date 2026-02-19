---
"@modular-prompt/core": patch
---

feat(core): ToolCall型を追加しMessageElementをUnion型に拡張

ToolCall型をcoreに定義し、MessageElementをStandardMessageElement | ToolResultMessageElementのUnion型に変更。tools会話ループのメッセージをElement経由で表現可能にした。
