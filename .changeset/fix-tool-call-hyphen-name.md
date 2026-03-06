---
"@modular-prompt/driver": patch
---

ハイフンを含む関数名のツールコールパースに対応

- qwen3_coder形式の関数名正規表現 `[\w.]+` を `[\w.\-]+` に修正
- `mcp__coeiro-operator__operator_status` のような関数名が正しくパースされるように
