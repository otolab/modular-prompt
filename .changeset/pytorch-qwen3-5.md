---
"@modular-prompt/driver": patch
---

PyTorch cpu-minimal runtime の Transformers を `>=5.14.0`（互換する `safetensors==0.8.0`）に更新し、`qwen3_5` モデルを利用できるようにしました。既存の PyTorch runtime 利用者は `setup-pytorch` を再実行し、必要に応じて runtime 側の依存制約を更新してから sync してください。
