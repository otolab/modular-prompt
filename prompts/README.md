# プロセスドキュメント

このディレクトリには、Moduler Promptプロジェクトの開発プロセスに関する文書を格納しています。「どう作るか」「どう管理するか」を説明します。

## 運用ガイド

### ドキュメント管理

- **[ドキュメントとコードの同期管理](./document-code-sync.md)** - コードとドキュメントの同期運用
- **[ドキュメント校正ガイド](./DOCUMENT_PROOFREADING_GUIDE.md)** - 校正の原則・プロセス・基準・修正パターン
- **[校正チェックリスト](./PROOFREADING_CHECKLIST.md)** - 実作業用クイックリファレンス

### リリース手順

- **[リリースガイド](./RELEASE_GUIDE.md)** - バージョン管理とリリースフロー

## 設計メモ（memos/）

技術的意思決定の経緯を記録するメモです。

### MLX関連

- **[MLX API選択リファクタリング](./memos/mlx-api-selection-refactoring.v1.md)** - Chat/Completion API選択の改善設計
- **[MLX機能リファクタリング](./memos/mlx-capability-refactoring.v1.md)** - MLXドライバーの機能判定方式の見直し
- **[MLX Force Completionバグ](./memos/mlx-driver-force-completion-bug.v1.md)** - forceCompletionオプションのバグ調査
- **[ModelSpecリネーム計画](./memos/mlx-modelspec-rename-plan.v1.md)** - ModelSpec型のリネーム検討
- **[ModelSpec比較](./memos/modelspec-comparison.v1.md)** - ModelSpec方式の技術的比較

---

**Note**: プロダクトそのものについての文書（仕様・使い方・アーキテクチャ等）は [docs/](../docs/) を参照してください。
