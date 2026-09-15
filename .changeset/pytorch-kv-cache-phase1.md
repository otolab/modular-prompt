---
"@modular-prompt/driver": minor
---

PyTorch (Transformers) LIP バックエンドで、同一プロセス内の KV キャッシュを `cache_prefill` と `generate` から利用できるようにしました。ディスク永続化と `PyTorchCacheController` 連携は後続フェーズで対応します。
