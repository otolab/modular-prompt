---
"@modular-prompt/driver": patch
"@modular-prompt/process": patch
"@modular-prompt/experiment": patch
---

thinkingContent伝播とMLX trustRemoteCodeオプション追加

- ドライバーが抽出したthinkingContentを全ワークフロー→WorkflowResult→RunResultまで伝播
- MlxMlModelOptionsにtrustRemoteCodeを追加（apply_chat_templateでリモートコード実行を許可）
- PARAMETER_CONSTRAINTSのホワイトリスト管理を明示化
