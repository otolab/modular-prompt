---
"@modular-prompt/extract": minor
"@modular-prompt/driver": patch
---

feat: ExtractSession に PromptCacheController 連携を追加（Phase 2）

`createExtractSession` がセッション単位で KV キャッシュを prepare / release し、毎回のクエリに `cacheHandle` を渡す。driver 側は `QueryOptions.cacheHandle` で外部 prepare を利用可能。

Closes #332
