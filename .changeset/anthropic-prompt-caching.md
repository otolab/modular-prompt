---
'@modular-prompt/driver': minor
---

Anthropicドライバーにプロンプトキャッシング（cache_control）サポートを追加。
QueryOptionsに`cache: true`を指定することで、静的なシステムプロンプトやメッセージ履歴にephemeralキャッシュコントロールを適用。
