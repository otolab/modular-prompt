---
"@modular-prompt/driver": patch
---

runtime:status で PyTorch runtime の variant / torch バージョンを表示

- `RuntimeManifest` 型に `variant` / `torchVersion` を追加
- `collectInstalledPackages` が venv の Python を明示参照するよう修正
