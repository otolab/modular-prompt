---
"@modular-prompt/process": minor
---

ワークフローでDriverSet（役割別ドライバー）を受け取れるように

- `DriverInput` 型を追加: `AIDriver | DriverSet` のユニオン型で後方互換を維持
- `ModelRole` 型: `default`, `thinking`, `instruct`, `chat`, `plan` の5種類
- `resolveDriver()` ヘルパー: 役割に応じたドライバー解決（フォールバック付き）
- 全8ワークフロー関数の第1引数を `DriverInput` に変更
