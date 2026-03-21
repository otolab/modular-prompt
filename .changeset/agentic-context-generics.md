---
"@modular-prompt/process": minor
---

feat: agenticProcess をジェネリクス化し、コンテキスト型を整理

- `agenticProcess<T>` — ユーザーは任意のコンテキスト型でモジュールの DynamicContent を解決可能に
- `AgenticWorkflowContext` から `objective` と `inputs` を削除（内部専用に）
- `AgenticResumeState` を新設 — ワークフロー再開用の型（`taskList`, `executionLog`, `state`）
- 再開は `options.resumeState` で渡す方式に変更
- `inputs` セクションは `userModule.inputs` を参照するように修正
