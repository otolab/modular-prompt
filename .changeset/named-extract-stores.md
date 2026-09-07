---
"@modular-prompt/extract": minor
---

feat(extract): cache container 内で storename ごとの複数 store をサポート

`modular-extract` の create/extract CLI に storename を導入し、store ごとの manifest/KV キャッシュと `list` サブコマンドを追加する。旧 CLI 引数形式と旧 cache レイアウトからの自動移行は行わない。

Closes #353
