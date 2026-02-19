---
"@modular-prompt/utils": patch
---

fix(utils): loggerのJSONLファイル書き込み順序を修正

flushToFileの並列書き込みを逐次書き込みに変更し、エントリの書き込み順序を保証。
