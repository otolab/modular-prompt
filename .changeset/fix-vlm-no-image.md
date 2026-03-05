---
"@modular-prompt/driver": patch
---

VLMモデルで画像なしリクエスト時のmake_samplerエラーを修正

- VLMモデルでも画像なしの場合に常にVLM用生成パスを使用するよう修正
- 画像が空の場合はimage=Noneを渡すよう修正
