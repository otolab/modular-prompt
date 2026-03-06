---
"@modular-prompt/driver": patch
---

VLMモデルでtools/primerが無視される問題を修正

- handle_chat_vlmにtools・primerパラメータを追加
- apply_chat_templateへのtools渡し（TypeErrorフォールバック付き）
- primer処理をhandle_chatと同じパターンで実装
