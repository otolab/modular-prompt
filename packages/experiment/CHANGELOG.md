# @modular-prompt/experiment

## 0.4.17

### Patch Changes

- Updated dependencies [9a02d5e]
- Updated dependencies [e35aab8]
  - @modular-prompt/driver@0.11.4
  - @modular-prompt/process@0.4.4

## 0.4.16

### Patch Changes

- Updated dependencies [71c44dc]
  - @modular-prompt/driver@0.11.3
  - @modular-prompt/process@0.4.3

## 0.4.15

### Patch Changes

- Updated dependencies [0f874ea]
  - @modular-prompt/driver@0.11.2
  - @modular-prompt/process@0.4.2

## 0.4.14

### Patch Changes

- Updated dependencies [507daea]
- Updated dependencies [507daea]
  - @modular-prompt/process@0.4.1
  - @modular-prompt/driver@0.11.1

## 0.4.13

### Patch Changes

- Updated dependencies [c954f60]
- Updated dependencies [9c48e56]
  - @modular-prompt/process@0.4.0

## 0.4.12

### Patch Changes

- Updated dependencies [c23d67e]
- Updated dependencies [81f859b]
  - @modular-prompt/process@0.3.9

## 0.4.11

### Patch Changes

- Updated dependencies [d5d80cc]
  - @modular-prompt/driver@0.11.0
  - @modular-prompt/utils@0.3.3
  - @modular-prompt/process@0.3.8

## 0.4.10

### Patch Changes

- af55885: 全パッケージの依存バージョンを固定（^ を除去し == に統一）。Python 依存（mlx-driver, vllm-driver）も同様に固定。
- Updated dependencies [af55885]
- Updated dependencies [f003192]
  - @modular-prompt/core@0.2.2
  - @modular-prompt/driver@0.10.6
  - @modular-prompt/utils@0.3.2
  - @modular-prompt/process@0.3.7

## 0.4.9

### Patch Changes

- Updated dependencies [17f3a50]
- Updated dependencies [17f3a50]
  - @modular-prompt/process@0.3.6
  - @modular-prompt/driver@0.10.5

## 0.4.8

### Patch Changes

- Updated dependencies [bce7391]
  - @modular-prompt/process@0.3.5

## 0.4.7

### Patch Changes

- Updated dependencies [d6742ee]
  - @modular-prompt/driver@0.10.4
  - @modular-prompt/process@0.3.4

## 0.4.6

### Patch Changes

- Updated dependencies [3440874]
  - @modular-prompt/process@0.3.3

## 0.4.5

### Patch Changes

- Updated dependencies [c7cf2dc]
  - @modular-prompt/driver@0.10.3
  - @modular-prompt/process@0.3.2

## 0.4.4

### Patch Changes

- Updated dependencies [ad15839]
- Updated dependencies [c2ba74f]
- Updated dependencies [afe7be5]
  - @modular-prompt/process@0.3.1
  - @modular-prompt/driver@0.10.2

## 0.4.3

### Patch Changes

- Updated dependencies [e2f5700]
- Updated dependencies [0b2eeb6]
  - @modular-prompt/process@0.3.0

## 0.4.2

### Patch Changes

- Updated dependencies [5590292]
  - @modular-prompt/process@0.2.2

## 0.4.1

### Patch Changes

- Updated dependencies [47b9eda]
  - @modular-prompt/core@0.2.1
  - @modular-prompt/process@0.2.1
  - @modular-prompt/driver@0.10.1
  - @modular-prompt/utils@0.3.1

## 0.4.0

### Minor Changes

- 749e29e: agentic workflow の改善: タスクベース・tool calling 方式への再設計、プロンプト品質向上、insertAt 順序修正
- 7a4e2af: testCase.models でインライン DriverSet 定義をサポート

  - テストケースの models に文字列（モデル名）またはオブジェクト（ロール → モデル名マッピング）を指定可能
  - DriverManager の型安全性を改善（any → AIDriver）

### Patch Changes

- 6d01df5: agentic-workflow の actions/ActionHandler を tool calling API に置き換え

  - ToolSpec 型（ToolDefinition + handler）を導入
  - execution フェーズに tool calling loop を実装
  - agent-workflow（簡易版）を削除
  - TestDriver に toolCalls サポート追加
  - experiment dynamic-loader の.ts モジュールファイル対応

- Updated dependencies [6d01df5]
- Updated dependencies [749e29e]
- Updated dependencies [fec7974]
- Updated dependencies [0698360]
  - @modular-prompt/process@0.2.0
  - @modular-prompt/driver@0.10.0
  - @modular-prompt/core@0.2.0
  - @modular-prompt/utils@0.3.0

## 0.3.6

### Patch Changes

- Updated dependencies [a732958]
  - @modular-prompt/driver@0.9.3
  - @modular-prompt/process@0.1.28

## 0.3.5

### Patch Changes

- Updated dependencies [b57fcec]
- Updated dependencies [708f42c]
  - @modular-prompt/driver@0.9.2
  - @modular-prompt/process@0.1.27

## 0.3.4

### Patch Changes

- Updated dependencies [fbf6055]
  - @modular-prompt/driver@0.9.1
  - @modular-prompt/process@0.1.26

## 0.3.3

### Patch Changes

- Updated dependencies [d78df1b]
- Updated dependencies [9d23d3f]
  - @modular-prompt/driver@0.9.0
  - @modular-prompt/process@0.1.25

## 0.3.2

### Patch Changes

- 4b476dc: 実験ランナーのリファクタリング

  - テスト実行をモデルごとにグループ化（アウトオブオーダー実行）
  - モジュール定義を PromptModule 直接エクスポートに変更
  - defaultProcess による実行に統一
  - 実行結果を元の定義順にソートして返す（retire phase）

- Updated dependencies [4b476dc]
- Updated dependencies [23886fc]
  - @modular-prompt/process@0.1.24
  - @modular-prompt/driver@0.8.2

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
