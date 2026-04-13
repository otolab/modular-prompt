---
"@modular-prompt/process": patch
---

fix: planning フェーズの Original Request を blockquote 形式に変更

Original Request material の content に markdown blockquote (`> `) を適用し、プランニングプロンプト自体の構造と引用データを視覚的に区別できるようにした。
