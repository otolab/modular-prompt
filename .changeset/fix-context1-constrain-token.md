---
"@modular-prompt/driver": patch
---

fix: context-1 パーサーが `<|constrain|>` 等の特殊トークンを含む出力を正しくパースできない問題を修正

- `parseContext1ToolCalls` の正規表現 `[^<]*` → `[\s\S]*?` に変更
- `get_tool_stop_token_ids()` で `special_tokens.tool_call_end.id` を直接使用するように改善
- stop token チェックで `response.token` を `int()` キャストして型安全性を確保
