---
"@modular-prompt/driver": major
---

PyTorch runtime をパッケージ内の template と `~/.modular-prompt/runtimes/pytorch/` の runtime に分離しました。既存ユーザーは `setup-pytorch` を再実行して runtime 側の Python プロジェクトを seed してください。runtime 側の `pyproject.toml` を編集したあとは `modular-prompt-runtime sync pytorch` でコードと依存を更新できます。
