---
"@modular-prompt/driver": patch
---

vLLM ドライバーの追加

- AsyncLLMEngine を使用したローカル GPU 推論ドライバー
- Python エンジンが Unix ドメインソケットで独立稼働、TypeScript が接続
- vLLM ネイティブの ToolParserManager でツールコールパース
