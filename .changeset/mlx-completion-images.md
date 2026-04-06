---
"@modular-prompt/driver": patch
---

feat: MLX completion API の VLM 画像対応インフラ追加

- completion API に images/maxImageSize パラメータを追加し、VLM モデルで画像付き completion 推論を可能にする
- apply_chat_template の判定をテンプレート設定有無まで確認するよう修正
- VLM フォールバック用ダミー画像アセットを追加
