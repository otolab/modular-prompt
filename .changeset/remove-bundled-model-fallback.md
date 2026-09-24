---
"@modular-prompt/extract": patch
"@modular-prompt/simple-chat": patch
---

同梱 MLX モデルへの暗黙の fallback を廃止し、モデル未指定時は明示的なエラーを返すようにしました。`-m`、profile/workflow、または user `models.default` でモデルを指定してください。

Closes #365
