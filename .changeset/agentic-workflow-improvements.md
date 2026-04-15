---
"@modular-prompt/process": minor
"@modular-prompt/experiment": patch
---

agenticワークフローのplanningタスク改善とexperiment安定性向上

- planningタスク後のdepベーストポロジカルソートを追加（タスク登録順に依存しない正しい実行順序）
- planningプロンプトの分析出力指示を改善
- recallタスクの説明を内部知識検索として明確化
- experiment結果のJSON保存機能を追加
- DriverSetドライバをモデルグループ完了時に都度closeするよう修正
