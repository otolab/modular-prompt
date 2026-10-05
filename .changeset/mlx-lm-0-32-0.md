---
"@modular-prompt/driver": patch
---

Issue #404: MLX の `mlx-lm` を 0.31.3 から 0.32.0 に更新しました。

`mlx-lm` 0.32.0 で upstream の prompt-cache serializer が変更されたため、
0.31.3 以前に作成した LM KV cache（`.safetensors.zip`）は後方互換ではありません。
既存 cache は load 失敗時にそのリクエストだけ cold generation へ戻りますが、
古い archive と `.meta.json` は残り、自動 invalidate や次回 prefill による再生成は行いません。
同じ cache key で再生成する場合は、利用者が該当 cache（または cache ディレクトリ）を
削除してから明示的に prefill を実行するか、新しい cache key を使用してください。
`.meta.json` からの手動変換はサポートしません。
