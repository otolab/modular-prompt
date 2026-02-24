---
"@modular-prompt/driver": patch
---

feat(driver): MLXドライバのログ出力をLogger統合 (#121)

MLXドライバ内のconsole.*を@modular-prompt/utilsのLoggerに置き換え。
Loggerのグローバルレベル設定でPythonプロセスのstderr出力も制御可能に。
