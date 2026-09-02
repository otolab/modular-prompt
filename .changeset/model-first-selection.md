---
"@modular-prompt/driver": minor
"@modular-prompt/simple-chat": minor
---

refactor: models.yaml の defaults/runtime 解決を廃止し model 先行のモデル選択に統一

**破壊的変更（driver）**

- `ModelsConfig.defaults` と `resolveDefaultModel()` を削除
- `resolveModelReference({ runtime })` 経路を削除
- `resolveDefaultModelFromConfig()` / `resolveModelName()` を追加（`models.default` alias または先頭エントリから導出）
- `ModelsConfigSource`（`merge` | `overlay`）を追加。`overlay` は user `models.yaml` を無視
- `AIService.fromModelsConfig()` / `fromOverlay()` / `fromMergedConfig()` ファクトリを追加

**simple-chat**

- `AIService` 経由でドライバ作成。bundled models + user + profile を merge
- `-m` / `profile.model` は alias 解決後に生 model 名として使用
- `textOnly` / `--text-only` に deprecated warning
- `inference-selection` の `mlxBackend: 'auto'` 暗黙付与を廃止

Closes #341
