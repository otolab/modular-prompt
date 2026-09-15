---
"@modular-prompt/driver": minor
---

PyTorch runtime に CUDA template variant を追加し、`setup pytorch --variant cuda --cuda <version>` で CUDA 対応 torch wheel を選択できるようにしました。runtime manifest と status に variant、CUDA バージョン、torch バージョン、CUDA の利用可否を表示します。

Closes #378
