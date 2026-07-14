---
"@modular-prompt/driver": patch
---

fix: MLX ドライバーの QueryOptions 処理を一本化し mode の Python 漏れを修正

`defaultOptions` を `Partial<MlxQueryOptions>` に統一。マージ後に `toMlxSamplingOptions` で
サンプリングパラメータのみ Python 層へ渡す。Closes #298
