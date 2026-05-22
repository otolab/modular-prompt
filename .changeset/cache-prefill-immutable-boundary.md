---
"@modular-prompt/driver": patch
---

fix: computePrefixInfoでimmutable Element境界のprefix hashを追加

section境界のみだったprefix hash計算に、最後のimmutable Elementの位置でのhashを追加。
チャット履歴のimmutableメッセージ部分がincrementalキャッシュで再利用されるようになり、
prefillのreuse率が大幅に向上する。
