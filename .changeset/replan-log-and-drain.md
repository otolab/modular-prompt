---
"@modular-prompt/process": patch
"@modular-prompt/utils": patch
---

fix: __replan ログ改善、__register_task 二重出力修正、Logger drain デフォルト化

- __replan の tool result に完了済み/残りタスクの情報を含めるようにした
- __register_task の tool result を登録確認のみに簡素化（並列呼び出し時の冗長出力を解消）
- Logger.getLogEntries() に drain オプション追加（デフォルト true）で蓄積の無制限増大を防止
