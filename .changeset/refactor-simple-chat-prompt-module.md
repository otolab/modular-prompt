---
"@modular-prompt/simple-chat": minor
"@modular-prompt/process": patch
---

refactor: simple-chat の systemPrompt を PromptModule 方式に移行

- DialogProfile: systemPrompt → module (PromptModule インライン定義)
- profile.yaml → default-profile.yaml にリネーム、PromptModule 形式に変換
- getDefaultProfile() → loadDefaultProfile() (async, YAML読み込み)
- ai-chat: buildChatModule() 導入、workflow mode (direct/default/agentic) 対応
- agentic-workflow: non-output タスクから objective を除去
