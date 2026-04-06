---
"@modular-prompt/driver": minor
---

feat: MlxDriver の context-1 モデル tool call 対応

- context-1 形式（`to=functions.{name}<|channel|>...<|message|>{json}<|call|>`）の検出・パースを追加
- `tool_call_format.call_end` を汎用 stop token として使用する機構を追加（context-1 以外のモデルにも有効）
