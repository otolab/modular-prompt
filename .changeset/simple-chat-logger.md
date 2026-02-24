---
"@modular-prompt/simple-chat": minor
---

feat(simple-chat): Logger対応とCLIオプション追加 (#119)

console.*を@modular-prompt/utilsのLoggerに置き換え、ログレベル制御を可能にした。
- パッケージ共通のlogger.tsを新規作成（prefix: simple-chat）
- 全ファイルのconsole呼び出しをloggerメソッドに移行
- CLIに--quiet/--verboseオプションを追加
