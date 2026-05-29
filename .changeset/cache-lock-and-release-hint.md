---
"@modular-prompt/driver": patch
---

feat: cache-index.jsonのファイルロック機構を追加し、invalidate()をrelease()ヒント機構に置き換え。proper-lockfileによるアドバイザリロックで外部プロセスとの安全な共有を実現。release()はキャッシュの「もう要らない」ヒントを送るだけで、実際の削除はclose()時またはキャッシュクリーンプロセスに委ねる設計に変更。
