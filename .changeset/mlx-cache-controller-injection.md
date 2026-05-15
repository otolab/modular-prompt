---
"@modular-prompt/core": minor
"@modular-prompt/driver": minor
"@modular-prompt/simple-chat": minor
---

CacheHintに'immutable'値を追加。DynamicContent出力の既存cacheHintをcompile()が尊重するように変更。MlxCacheControllerを外部注入パターンに統一し、キャッシュディレクトリの外部指定に対応。simple-chatプロファイルからcacheDirで設定可能に。会話履歴メッセージにimmutableヒントを付与しキャッシュ対象に。
