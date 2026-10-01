---
"@modular-prompt/driver": patch
---

GoogleGenAI ドライバーが外部 `cacheHandle` を再利用し、`cache: false` 指定時にドライバー側の重複したキャッシュ準備をスキップするようにしました。
