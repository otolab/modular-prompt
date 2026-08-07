---
"@modular-prompt/driver": minor
---

LIP Phase 4: `render` 分離と chat 暗黙整形の廃止

- Python `render` ハンドラ追加（`apply_chat_template` のみ）
- TS chat 経路を `render` + `generate` の2段に変更
- `generate_merged_prompt` を TS `generateMergedPrompt` に移行
- Python `chat` ハンドラ廃止、`generate` に KV キャッシュ・primer 対応を統合
