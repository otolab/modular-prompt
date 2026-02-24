---
"@modular-prompt/driver": patch
---

feat(driver): DriverRegistryのLoggerをグローバルレベル制御に統一 (#123)

DriverRegistryのLoggerからインスタンスレベル設定を除去。
Logger.configure()によるグローバルなログレベル制御が効くようになった。
