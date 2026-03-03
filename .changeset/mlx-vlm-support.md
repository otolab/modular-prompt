---
"@modular-prompt/driver": minor
---

MLXドライバーでmlx-vlmに対応

- ChatMessage.contentをstring | Attachment[]に拡張（全ドライバー共通）
- contentToString/extractImagePaths共通ユーティリティ追加
- model_type動的importによるVLM/LM自動判定
- VLMストリーミング生成（mlx_vlm.stream_generate）
- 画像自動リサイズ（maxImageSize、デフォルト768px）
