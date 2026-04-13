---
"@modular-prompt/driver": patch
---

fix: MLX プロセス通信のバグ修正と chat template 文字列の除去

- capabilities JSON から未使用の template_string フィールドを除去（レスポンスサイズ削減）
- handleJsonResponse と onRequestCompleted の二重呼び出しによる isProcessing フラグ不整合を修正
- null文字後のデータが消失するバグを修正（stdout バッファ結合時の対策）
