# @modular-prompt/core

## 0.2.0

### Minor Changes

- ea719c3: feat(core): ToolCall 型を追加し MessageElement を Union 型に拡張

  ToolCall 型を core に定義し、MessageElement を StandardMessageElement | ToolResultMessageElement の Union 型に変更。tools 会話ループのメッセージを Element 経由で表現可能にした。

## 0.1.10

### Patch Changes

- cac4dab: リネーム後のクリーンアップ

  - prepublishOnly スクリプトを修正（npm run → pnpm run）
  - リポジトリ URL を新しい名前に更新（moduler-prompt → modular-prompt）
  - experiment パッケージのビルド出力構造を修正（dist/src/ → dist/）
  - パッケージ説明文の修正

## 0.1.9

### Patch Changes

- afd3c40: fix: Element-only セクションで標準セクションタイトルが表示されない問題を修正

  MessageElement、MaterialElement、ChunkElement などの Element のみで構成されるセクションにおいて、標準セクションタイトルを持つ SectionElement が作成されない問題を修正しました。

  これにより、messages、materials、chunks などのセクションが Element のみで構成されている場合でも、正しくセクションタイトルが表示されるようになります。

  また、schema セクションの JSONElement 抽出処理を改善し、JSONElement のみの場合は空の SectionElement が作成されないようにしました。
