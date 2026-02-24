# @modular-prompt/experiment

## 0.3.1

### Patch Changes

- 64ab1f7: chore: npm パッケージに skills を同梱する仕組みを追加

  prepublishOnly 時に skills/<skill-name>/SKILL.md をパッケージ内にコピーし、npm パッケージに含めるようにした。

  - core: skills/prompt-writing/SKILL.md
  - driver: skills/driver-usage/SKILL.md
  - experiment: skills/experiment/SKILL.md

- Updated dependencies [64ab1f7]
- Updated dependencies [2fb9371]
- Updated dependencies [9831ef7]
  - @modular-prompt/core@0.1.13
  - @modular-prompt/driver@0.8.1
  - @modular-prompt/utils@0.2.4

## 0.3.0

### Minor Changes

- be3037c: feat(driver,experiment): MLXDriver の tools 対応 (#90)

  MLXDriver で Function Calling(tools)を使えるようにした。

  - native tools 対応モデル(Qwen3 等): apply_chat_template で注入
  - 非対応モデル(Gemma3 等): テキストフォールバック
  - tokenizer_config.json から tool_call_format を自動検出
  - experiment フレームワークに queryOptions(tools)対応を追加

### Patch Changes

- Updated dependencies [be3037c]
  - @modular-prompt/driver@0.8.0

## 0.2.0

### Minor Changes

- 68c1ead: feat(driver,experiment): MLXDriver の tools 対応 (#90)

  MLXDriver で Function Calling(tools)を使えるようにした。

  - native tools 対応モデル(Qwen3 等): apply_chat_template で注入
  - 非対応モデル(Gemma3 等): テキストフォールバック
  - tokenizer_config.json から tool_call_format を自動検出
  - experiment フレームワークに queryOptions(tools)対応を追加

### Patch Changes

- Updated dependencies [68c1ead]
  - @modular-prompt/driver@0.7.0

## 0.1.10

### Patch Changes

- Updated dependencies [866051c]
- Updated dependencies [1c8c8db]
  - @modular-prompt/driver@0.6.3
  - @modular-prompt/core@0.1.12
  - @modular-prompt/utils@0.2.3

## 0.1.9

### Patch Changes

- Updated dependencies [835a9b9]
  - @modular-prompt/core@0.1.11
  - @modular-prompt/driver@0.6.2
  - @modular-prompt/utils@0.2.2

## 0.1.8

### Patch Changes

- Updated dependencies [f17538c]
  - @modular-prompt/driver@0.6.1

## 0.1.7

### Patch Changes

- Updated dependencies [d7c8e5c]
- Updated dependencies [e0117fc]
  - @modular-prompt/utils@0.2.1
  - @modular-prompt/driver@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [50c66af]
  - @modular-prompt/driver@0.5.2

## 0.1.5

### Patch Changes

- Updated dependencies [84ac5c8]
  - @modular-prompt/driver@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [9a7660e]
  - @modular-prompt/driver@0.5.0

## 0.1.3

### Patch Changes

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

- Updated dependencies [2d9d217]
  - @modular-prompt/utils@0.2.0
  - @modular-prompt/driver@0.4.7

## 0.1.2

### Patch Changes

- 1f3b383: experiment パッケージの改善

  - evaluator を名前のみで参照可能に（builtin registry 追加）
  - evaluator 名を評価内容を明確に示すようにリネーム
    - json-validator → structured-output-presence
    - functional-correctness → llm-requirement-fulfillment
  - evaluator description を改善し評価結果表示に追加
  - --dry-run オプションを追加（実行計画のみ表示）
  - MLX 使用時にリソース消費の警告を表示
  - README.md に Built-in Evaluators セクションを追加

- cac4dab: リネーム後のクリーンアップ

  - prepublishOnly スクリプトを修正（npm run → pnpm run）
  - リポジトリ URL を新しい名前に更新（moduler-prompt → modular-prompt）
  - experiment パッケージのビルド出力構造を修正（dist/src/ → dist/）
  - パッケージ説明文の修正

- Updated dependencies [cac4dab]
  - @modular-prompt/core@0.1.10
  - @modular-prompt/driver@0.4.6

## 0.1.1

### Patch Changes

- Updated dependencies [d85ab2d]
  - @modular-prompt/driver@0.4.5
