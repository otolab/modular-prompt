---
"@modular-prompt/driver": minor
"@modular-prompt/extract": minor
---

MLX VLM の text-only KV prompt cache を `mlx-vlm` の `exact_cache_v1` 形式でディスク永続化し、extract runtime が `auto` / `vlm` backend の判定モデルを利用できるようにしました。LM の cache archive とは形式を分離しています。
