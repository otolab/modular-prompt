---
"@modular-prompt/driver": minor
"@modular-prompt/simple-chat": minor
---

feat: キャッシュのread-onlyモードを追加

`QueryOptions.cache`に`'read-only'`値を追加。既存キャッシュは使用するが、新規エントリの作成（increase）を行わないモード。

ユースケース:
- oneshotリクエストでキャッシュ書き込みを省略
- 重要なキャッシュをsupersedes自動削除から保護

simple-chatに`--cache`オプションを追加（`true`/`false`/`read-only`）。
ルートpackage.jsonのスクリプトを`pnpm --filter`による子パッケージ移譲形式に統一。
