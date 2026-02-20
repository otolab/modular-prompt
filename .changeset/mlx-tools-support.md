---
"@modular-prompt/driver": minor
"@modular-prompt/experiment": minor
---

feat(driver,experiment): MLXDriverのtools対応 (#90)

MLXDriverでFunction Calling(tools)を使えるようにした。
- native tools対応モデル(Qwen3等): apply_chat_templateで注入
- 非対応モデル(Gemma3等): テキストフォールバック
- tokenizer_config.jsonからtool_call_formatを自動検出
- experimentフレームワークにqueryOptions(tools)対応を追加
