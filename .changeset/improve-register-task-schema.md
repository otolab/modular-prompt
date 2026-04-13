---
"@modular-prompt/process": patch
---

fix: __register_task スキーマ改善と Gemma4 thinking ブロック除去対応

- `instruction` フィールドの説明を改善（実行AIワーカーが受け取る唯一の指示であることを明記）
- `reason` フィールドの説明を改善（プランニング品質の評価に使用される旨を追記）
- `insertAt` をツールスキーマおよび内部型から削除（内部の挿入順序管理に簡素化）
- Gemma4 の `<|channel>thought...<channel|>` ブロックを `<think>` と同様に除去する対応を追加
