---
"@modular-prompt/driver": minor
---

feat(driver): tools（Function Calling）サポートの追加

全ドライバー（OpenAI, Anthropic, GoogleGenAI, VertexAI, Ollama）にtools/function calling機能を追加。
QueryOptionsにtools/toolChoice、QueryResultにtoolCallsを追加し、ストリーミング時の並列tool calls蓄積にも対応。
