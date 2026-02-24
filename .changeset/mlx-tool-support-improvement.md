---
"@modular-prompt/driver": patch
---

MLXドライバのツールサポート検出・パース改善

- KNOWN_TOOL_PARSERS逆引きテーブルによるtool_parser_type対応（9種類）
- special tokens検出の命名規則拡張（_start/_end、XML形式等）
- hasNativeToolSupport()のマルチシグナル判定
- parseToolCalls()の複数パーサー形式対応
- formatToolDefinitionsAsText()のパラメータ簡潔化
