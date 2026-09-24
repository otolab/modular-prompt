---
"@modular-prompt/simple-chat": patch
"@modular-prompt/driver": patch
"@modular-prompt/extract": patch
"@modular-prompt/process": patch
---

公開 npm パッケージ向けに docs を `docs/packages/` に集約し、publish 時に `packages/*/docs/` へコピーする。README の `./docs/` リンク整備、`simple-chat --check` の models.yaml 表示、runtime 未セットアップ時メッセージの公開利用者向け修正を含む（#340）。
