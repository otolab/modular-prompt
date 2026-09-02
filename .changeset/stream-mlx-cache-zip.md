---
"@modular-prompt/driver": patch
---

fix(driver): MLX KV キャッシュをストリーミング zip 圧縮で保存

MLX の KV キャッシュを `.safetensors.zip` として保存し、保存時に非圧縮の中間ファイルを作成しないようにする。
