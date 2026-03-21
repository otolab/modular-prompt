---
"@modular-prompt/process": patch
---

agentic workflow: タスク指示・出力制御の改善

- 疑似thinkタグにタスク指示文を記載 [taskType: instruction] 形式
- taskCommon に担当外作業の抑制と不可能時の報告指示を追加
- planning のタスク指示文ガイダンスを調整
- タスクタイプごとの maxTokens 3段階制御 (low/middle/high)
- タスク実行結果を materials から preparationNote に移動
- planning の toolChoice を required から auto に変更
