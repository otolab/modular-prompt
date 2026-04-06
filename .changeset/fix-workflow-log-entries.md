---
"@modular-prompt/process": patch
---

fix: ワークフローレベルのログを WorkflowResult.logEntries に含めるように修正

- toolAgentProcess, agenticProcess, queryWithTools の Logger に `accumulate: true` を設定
- 各ワークフローのリターンパスで `logger.getLogEntries()` を logEntries に集約
- `logger.context()` で作成された子ロガーのエントリも明示的に収集
