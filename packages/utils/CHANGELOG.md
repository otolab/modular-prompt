# @modular-prompt/utils

## 0.2.2

### Patch Changes

- Updated dependencies [ea719c3]
  - @modular-prompt/core@0.2.0

## 0.2.1

### Patch Changes

- d7c8e5c: fix(utils): logger の JSONL ファイル書き込み順序を修正

  flushToFile の並列書き込みを逐次書き込みに変更し、エントリの書き込み順序を保証。

## 0.2.0

### Minor Changes

- 2d9d217: Enhanced logger system with async file output and improved output handling

  **@modular-prompt/utils**

  - Add `Logger` class with context support and log level filtering
  - Add async `flush()` method for explicit file writes (JSONL format)
  - Separate file write queue from memory accumulation
  - Fix output destination: info/verbose/debug to stdout in normal mode, stderr in MCP mode
  - Add `logger.context()` method for creating context-specific loggers
  - Add context filtering to `getLogEntries()` and `getLogStats()`

  **@modular-prompt/experiment**

  - Integrate enhanced logger with `--log-file` and `--verbose` options
  - Move detailed progress info to `logger.verbose()`
  - Add package-specific logger with 'experiment' prefix

## 0.1.5

### Patch Changes

- cac4dab: リネーム後のクリーンアップ

  - prepublishOnly スクリプトを修正（npm run → pnpm run）
  - リポジトリ URL を新しい名前に更新（moduler-prompt → modular-prompt）
  - experiment パッケージのビルド出力構造を修正（dist/src/ → dist/）
  - パッケージ説明文の修正

- Updated dependencies [cac4dab]
  - @modular-prompt/core@0.1.10

## 0.1.4

### Patch Changes

- Updated dependencies [afd3c40]
  - @modular-prompt/core@0.1.9
