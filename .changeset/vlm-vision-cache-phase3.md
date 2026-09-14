---
"@modular-prompt/driver": minor
"@modular-prompt/extract": minor
---

MLX VLM の画像付きプロンプトで vision feature reuse と VLM prompt/KV cache の永続化を利用できるようにしました。画像 cache は text-only cache および LM cache zip と別 namespace で管理します。
