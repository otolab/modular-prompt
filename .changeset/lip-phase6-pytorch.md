---
"@modular-prompt/driver": minor
---

LIP Phase 6: PyTorch バックエンド（cpu-minimal runtime）

- `PyTorchDriver` / `PyTorchProcess` を追加（`LocalInferenceDriver` 上に実装）
- `setup-pytorch` で CPU 最小 venv を `~/.modular-prompt/runtimes/pytorch/` に作成
- Transformers LM バックエンド（`packages/driver/src/pytorch/python`）
- 手動 CUDA / 外部 venv のドキュメントを `docs/LOCAL_MODEL_SETUP.md` に追加
