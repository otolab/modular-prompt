---
"@modular-prompt/driver": patch
---

mlx-lmの最低バージョンを0.30.4に引き上げ

GLM-4.7-Flash等の`glm4_moe_lite`モデルタイプのサポートがmlx-lm 0.30.4で追加されたため、pyproject.tomlの依存バージョン制約を`>=0.28.3`から`>=0.30.4`に更新しました。
