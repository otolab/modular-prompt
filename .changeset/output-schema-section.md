---
"@modular-prompt/driver": patch
---

fix: outputSchemaの挿入位置をInstructionsセクションからOutputセクションに移動。Outputセクションヘッダーはpreambleの"three main sections"宣言と一貫性を保つためデフォルトで常に出力されるように変更。alwaysIncludeOutputHeader: falseで抑制可能。これによりMlxDriverのoutputSchema使用時のキャッシュ迂回ガードが不要になり、routingリクエスト等でもキャッシュが利用可能に。
