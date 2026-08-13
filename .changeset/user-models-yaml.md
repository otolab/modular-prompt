---
"@modular-prompt/driver": patch
"@modular-prompt/simple-chat": patch
---

feat: `~/.modular-prompt/models.yaml` によるユーザーレベルモデル定義と driver-registry 統合

- `resolveModelsConfig` / `loadUserModelsConfig` 等の config 読み込みユーティリティを追加
- models 上書き（override）と浅いマージ（merge）モードをサポート
- simple-chat で `modelsConfig.mode` と `workflow.models.default.ref` をサポート
