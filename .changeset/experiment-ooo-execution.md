---
"@modular-prompt/experiment": patch
---

実験ランナーのリファクタリング

- テスト実行をモデルごとにグループ化（アウトオブオーダー実行）
- モジュール定義をPromptModule直接エクスポートに変更
- defaultProcessによる実行に統一
- 実行結果を元の定義順にソートして返す（retire phase）
