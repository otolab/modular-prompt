---
"@modular-prompt/process": minor
"@modular-prompt/driver": patch
"@modular-prompt/experiment": patch
---

agentic-workflowのactions/ActionHandlerをtool calling APIに置き換え

- ToolSpec型（ToolDefinition + handler）を導入
- executionフェーズにtool calling loopを実装
- agent-workflow（簡易版）を削除
- TestDriverにtoolCallsサポート追加
- experiment dynamic-loaderの.tsモジュールファイル対応
