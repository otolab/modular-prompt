---
"@modular-prompt/extract": minor
---

feat(extract): add `modular-extract add` for incremental store expansion

既存 store にファイルを追加し、incremental prefill で corpus と KV cache を拡張できるようにしました。`--dry-run`、重複 id の検証、失敗時に既存 store を保持する staging 更新、manifest の `updatedAt` に対応します。

Closes #355
