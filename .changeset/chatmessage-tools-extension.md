---
"@modular-prompt/driver": patch
---

fix(driver): ChatMessageにtool call/tool resultの表現力を追加

ChatMessageをUnion型に拡張し、QueryOptions.messagesでtools会話ループを実現可能にした。
