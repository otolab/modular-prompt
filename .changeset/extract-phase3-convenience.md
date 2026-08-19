---
"@modular-prompt/extract": minor
---

feat: ExtractSession Phase 3 — デフォルト base module、structured output、previousExtractions ヘルパ

- `baseModule` をオプショナル化し `defaultExtractBaseModule` を提供
- `mergeExtractBaseModule` でカスタム overlay の merge パターンをサポート
- `buildPreviousExtractionsInputs` / `formatPreviousExtractions` で段階的深掘りの inputs 組み立てを簡潔化
- `schema` 指定時の structured output をテストで担保

Closes #333
