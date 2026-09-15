---
"@modular-prompt/driver": patch
"@modular-prompt/simple-chat": patch
"@modular-prompt/extract": patch
---

生の model ID に対する provider 解決を共通化し、merged models の一致エントリ・runtime metadata・既知のモデル名パターンを利用できるようにしました。provider を推論できない場合は、誤った runtime を選ばず `--provider <provider>` の明示指定を促すエラーを返します。

Closes #373
