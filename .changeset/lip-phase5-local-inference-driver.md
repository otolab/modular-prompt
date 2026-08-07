---
"@modular-prompt/driver": minor
---

LIP Phase 5: LocalInferenceDriver 抽出

- `local-inference/driver.ts` に共通 AIDriver 骨格を新設
- `MlxDriver` を MLX 固有設定の薄いラッパにリファクタ
- ストリーム META 処理を `stream-utils.ts` に分離
