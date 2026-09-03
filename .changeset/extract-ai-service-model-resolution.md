---
"@modular-prompt/driver": patch
"@modular-prompt/extract": patch
---

extract のモデル解決を AIService 経由に統一し、models.yaml の alias と生の MLX model ID を利用可能にする。driver から cache controller を注入できるようにし、runtime のキャッシュライフサイクルを維持する。
