---
"@modular-prompt/driver": patch
---

fix: outputSchemaの挿入位置をInstructionsセクションからOutputセクションに移動。Outputセクションの表示条件をoutput要素またはoutputSchemaの有無で判定するように変更。これによりMlxDriverのoutputSchema使用時のキャッシュ迂回ガードが不要になり、routingリクエスト等でもキャッシュが利用可能に。
