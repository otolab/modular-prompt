---
"@modular-prompt/driver": minor
"@modular-prompt/simple-chat": minor
---

feat: ユーザーレベル `models.yaml` と overlay によるモデル解決（利用者契約の仕様変更）

`~/.modular-prompt/models.yaml`（`MODULAR_PROMPT_HOME` 可）からユーザ定義 models を読み込み、利用側が投入する overlay と **overlay > user** の優先順位で解決する。プロジェクト配下の暗黙探索は行わない。

**利用側ツール向け（仕様上の注意）**

- `resolveModelsConfig()` / `loadUserModelsConfig()` 利用時、overlay を渡さなくても **ユーザ設定が解決結果に混入しうる**
- 既定の `mode: 'merge'` では user models がベースに残る。ツール独自定義のみにしたい場合は `mode: 'override'` 等の設計判断が必要
- 利用者向けに「ホームディレクトリの `models.yaml` が影響する」ことを明記すること

**driver**

- `resolveModelsConfig` / `loadUserModelsConfig` / `mergeModelsConfig` / `resolveModelReference` / `registerModelsFromConfig` を追加
- `merge`（浅いマージ）と `override`（models の置換）をサポート

**simple-chat**

- profile の `modelsConfig`（inline `models` / `defaults` / `drivers`）と `workflow.models.default.ref` をサポート

Closes #304
