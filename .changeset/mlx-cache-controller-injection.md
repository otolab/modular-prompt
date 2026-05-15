---
"@modular-prompt/core": minor
"@modular-prompt/driver": minor
"@modular-prompt/simple-chat": minor
---

CacheHintに'immutable'値を追加。DynamicContent出力の既存cacheHintをcompile()が尊重するように変更。MlxCacheControllerを外部注入パターンに統一し、キャッシュディレクトリの外部指定に対応。simple-chatプロファイルからcacheDirとlogPathで設定可能に。会話履歴メッセージにimmutableヒントを付与しキャッシュ対象に。

インクリメンタルKVキャッシュを実装。cache_prefillがbase_cache_pathを受け取り、既存キャッシュをロードして差分トークンのみ処理。セッション内はlastHandle、cross-sessionはcache-index.jsonによるprefix matchでbase cacheを自動探索。
