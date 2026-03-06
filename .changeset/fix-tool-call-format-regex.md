---
"@modular-prompt/driver": patch
---

tool_call終了タグの正規表現バグを修正

- `detect_tool_call_format`の終了タグ検出パターンが開始タグにもマッチしていた問題を修正
- Qwen3.5等の`tool_parser_type`を持たないモデルでツールコールのパースが失敗していた
- Qwen3.5の改行を含むXML形式出力のテストケースを追加
