---
"@modular-prompt/driver": patch
---

mlx-vlm を 0.7.4 に更新しました。既存の text-only VLM exact cache は互換性を維持しますが、0.7.4 の interleaved image formatting 変更に伴い、0.7.0 で作成した vision cache は version mismatch として miss し、cold prefill から再構築されます。
