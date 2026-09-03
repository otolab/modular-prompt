---
"@modular-prompt/driver": patch
"@modular-prompt/simple-chat": patch
---

setup-mlx / setup-pytorch コマンドを単一ソース（`setup-commands-core.mjs`）に統一し、monorepo ルートの再帰バグを `--filter` 委譲で修正。runtime CLI を `modular-runtime` bin として公開
