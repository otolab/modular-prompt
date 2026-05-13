---
'@modular-prompt/driver': minor
---

Google GenAIドライバーにプロンプトキャッシング対応を追加。
PromptCacheControllerインターフェースとGoogleGenAICacheController実装を提供。
Element変換ロジックをelement-converter.tsに抽出し、ドライバーとCacheControllerで共有。
