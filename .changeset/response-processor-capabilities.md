---
"@modular-prompt/driver": minor
---

refactor: レスポンスプロセッサをcapabilities駆動に統合

- selectResponseProcessorが常にResponseProcessorを返すように変更（null返却を廃止）
- createDefaultProcessorファクトリを追加（thinking抽出 + ツールコール解析を合成）
- Gemma-4の`<|channel>thought...<channel|>`形式のthinking抽出をサポート
- mlx-driverのpost-processing分岐を統合（if/else → 一本道）
- model-handlers.tsの内部関数11個をunexport化（公開APIを整理）
