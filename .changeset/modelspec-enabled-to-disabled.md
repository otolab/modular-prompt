---
"@modular-prompt/driver": patch
---

fix(driver): ModelSpec.enabled を disabled に変更し、AIService.selectModels() で無効モデルを除外

ModelSpec.enabled フラグを disabled に変更。デフォルトで有効、明示的に `disabled: true` で無効化するシンプルな設計に統一。AIService.selectModels() に disabled チェックを追加し、無効モデルが選択されない問題を修正。(#88)
