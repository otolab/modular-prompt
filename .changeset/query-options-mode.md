---
"@modular-prompt/driver": minor
---

QueryOptionsにmodeプロパティを追加

- クエリ実行モード（default/thinking/instruct/chat）をドライバー非依存で指定可能に
- Anthropic: thinkingオプションと組み合わせてExtended Thinkingを有効化
- OpenAI: reasoningEffortオプションと組み合わせてreasoningを有効化
- Google GenAI: mode=thinkingでthinkingConfigを自動適用
- MLX: instruct/chatでAPI選択に反映
