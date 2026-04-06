---
"@modular-prompt/driver": patch
---

fix: context-1 モデルの tool_call_end 単体トークンによる tool call 検出対応

- `hasNativeToolSupport()` で `tool_call_end` 単体トークンも認識するように修正
- `get_tool_stop_token_ids()` で `special_tokens.tool_call_end` へのフォールバックを追加
- `parseToolCalls()` で `tool_call_end` 特殊トークンから context-1 パーサーを起動するように修正
