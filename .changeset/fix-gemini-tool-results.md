---
"@modular-prompt/driver": patch
---

fix: Gemini API の複数 functionResponse を1つの user メッセージにまとめるように修正

VertexAI / GoogleGenAI ドライバーで、複数の tool result（functionResponse）がそれぞれ個別の user メッセージに変換されていた問題を修正。Gemini API は1つの model メッセージ内の複数 functionCall に対応する functionResponse を、1つの user メッセージにまとめる必要がある。
