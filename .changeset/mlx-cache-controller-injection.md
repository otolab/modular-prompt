---
"@modular-prompt/driver": minor
"@modular-prompt/simple-chat": minor
---

MlxCacheControllerを外部注入パターンに統一。enableCachingフラグを廃止し、cacheController外部注入に変更。キャッシュディレクトリの外部指定に対応し、simple-chatプロファイルからcacheDirで設定可能に。
