---
"@modular-prompt/core": patch
"@modular-prompt/driver": patch
"@modular-prompt/utils": patch
"@modular-prompt/process": patch
"@modular-prompt/experiment": patch
"@modular-prompt/simple-chat": patch
---

全パッケージの依存バージョンを固定（^ を除去し == に統一）。Python 依存（mlx-driver, vllm-driver）も同様に固定。
