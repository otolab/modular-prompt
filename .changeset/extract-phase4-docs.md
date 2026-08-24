---
"@modular-prompt/extract": minor
---

feat(extract): Phase 4 — ドキュメント・CLI・キャッシュ永続化

- README・examples・API.md・プロジェクトドキュメント参照（#334）
- `modular-extract` CLI（`create` / `extract` / `--dry-run`）
- mlx-lm バックエンド固定、maxTokens デフォルト 8000
- 固定 cacheDir で KV ファイルを残す `session.close({ releaseCache: false })`

Closes #334
