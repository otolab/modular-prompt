---
"@modular-prompt/driver": patch
---

feat: CacheHandleにsupersedesフィールドを追加。incrementalプリフィル時に置き換え元キャッシュのrefを返すことで、呼び出し側での古いキャッシュ削除を可能にした。
