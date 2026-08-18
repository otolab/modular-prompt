---
"@modular-prompt/extract": minor
---

feat: `@modular-prompt/extract` パッケージを追加（Phase 1 コア API）

`createExtractSession`, `ExtractSession.extract`, `getHistory`, `close` を実装。文書抽出向けに `baseModule` + `corpus` + リクエストごとの `cue` / `inputs` を `merge()` → `compile()` → `driver.query()` で実行する。

Closes #331
