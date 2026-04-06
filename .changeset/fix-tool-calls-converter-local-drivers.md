---
"@modular-prompt/driver": patch
---

fix: converter・MLX・vLLMドライバーでtoolCalls/toolResultメッセージを正しく処理

formatPromptAsMessagesのelementToMessages()がtoolCallsとtool resultメッセージを
失っていた問題、およびMLX・vLLMドライバーのconvertMessages()がこれらのメッセージを
無視していた問題を修正。
