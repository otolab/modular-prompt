---
"@modular-prompt/driver": minor
---

feat(driver): `models.testing.yaml` の profile 解決とローカル統合テスト設定を追加

`~/.modular-prompt/models.testing.yaml` を Vitest / `NODE_ENV=test` の自動マージ、または `MODULAR_PROMPT_MODELS_PROFILE=testing` の明示 profile として利用できます。既存の `test-drivers.yaml` は後方互換のためフォールバックします。

Closes #356
