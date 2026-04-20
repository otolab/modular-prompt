---
"@modular-prompt/driver": minor
"@modular-prompt/process": patch
"@modular-prompt/experiment": patch
---

tool call形式検出・パーサー選択の一元化と`<think>`タグ抽出のドライバー統合

- tool call形式検出をtool_call_format（Python側検出結果）に一元化
- hasNativeToolSupport()を簡素化（5シグナル → tool_call_format.call_startのみ）
- selectResponseProcessorをtool_parser_typeベースに変更
- parseToolCallsからHarmony/context-1重複パスを削除
- Harmonyレスポンスパーサーでストリーム出力（暗黙`<|start|>`省略）に対応
- `<think>`タグ抽出をcontent-utils.extractThinkingContent()に統合し、QueryResult.thinkingContentで一本化
- process/experimentの個別stripThinkBlocks処理を廃止
