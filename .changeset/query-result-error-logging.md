---
"@modular-prompt/driver": minor
"@modular-prompt/utils": patch
---

QueryResult に `logEntries` / `errors` フィールドを追加し、クエリ実行中のログ・エラー情報を構造化して caller に返却するよう変更。

- `QueryLogger` ヘルパーを新規追加（クエリスコープのログ収集）
- 全ドライバー（OpenAI, Anthropic, VertexAI, GoogleGenAI, MLX, vLLM）で Logger を統一
- `console.error` / `console.warn` の直接使用を全廃止
- `@modular-prompt/utils` から `LogEntry` 型をエクスポート
