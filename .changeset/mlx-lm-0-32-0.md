---
"@modular-prompt/driver": patch
---

Issue #404: MLX の `mlx-lm` を 0.31.3 から 0.32.0 に更新しました。

`mlx-lm` 0.32.0 で upstream の prompt-cache serializer が変更されたため、
0.31.3 以前に作成した LM KV cache（`.safetensors.zip`）は後方互換ではありません。
既存 cache は load 失敗時に cold path へ戻り、次回の prefill で再生成されます。
`.meta.json` からの手動変換はサポートしません。
