# @modular-prompt/process

## 0.4.1

### Patch Changes

- 507daea: fix: queryWithTools で外部ツール混在時の function call/response 数不一致を修正
- Updated dependencies [507daea]
  - @modular-prompt/driver@0.11.1

## 0.4.0

### Minor Changes

- 9c48e56: toolAgentProcess ワークフローを追加。外部からツール（定義+ハンドラー）を渡してエージェントループを実行するシンプルなワークフロー。ToolSpec/ToolCallLog 型を共有型に移動。

### Patch Changes

- c954f60: toolAgentProcess: 毎ターン re-compile + handler に context を渡す拡張。ToolAgentContext 型を追加し、ToolSpec の handler シグネチャに context 引数を追加。

## 0.3.9

### Patch Changes

- c23d67e: WorkflowResult の consumedUsage/responseUsage/logEntries/errors フィールドおよび aggregateUsage/aggregateLogEntries ユーティリティのドキュメントを追加。
- 81f859b: WorkflowResult に consumedUsage/responseUsage/logEntries/errors フィールドを追加。全ワークフローでドライバーのログ・usage 情報を伝搬するように改善。

## 0.3.8

### Patch Changes

- Updated dependencies [d5d80cc]
  - @modular-prompt/driver@0.11.0
  - @modular-prompt/utils@0.3.3

## 0.3.7

### Patch Changes

- af55885: 全パッケージの依存バージョンを固定（^ を除去し == に統一）。Python 依存（mlx-driver, vllm-driver）も同様に固定。
- Updated dependencies [af55885]
- Updated dependencies [f003192]
  - @modular-prompt/core@0.2.2
  - @modular-prompt/driver@0.10.6
  - @modular-prompt/utils@0.3.2

## 0.3.6

### Patch Changes

- 17f3a50: \_\_register_tasks で不正な taskType をツールエラーとして返し、モデルにリトライの機会を与えるバリデーションを追加
- Updated dependencies [17f3a50]
  - @modular-prompt/driver@0.10.5

## 0.3.5

### Patch Changes

- bce7391: agentic workflow のデータ可視性を opt-out 方式に変更（withoutXxx）、planning プロンプトを改善

## 0.3.4

### Patch Changes

- Updated dependencies [d6742ee]
  - @modular-prompt/driver@0.10.4

## 0.3.3

### Patch Changes

- 3440874: agentic workflow の成果物ベース計画設計への移行と replanning 統合

## 0.3.2

### Patch Changes

- Updated dependencies [c7cf2dc]
  - @modular-prompt/driver@0.10.3

## 0.3.1

### Patch Changes

- ad15839: agentic workflow プロンプト改善: シングルクエリ化、planning 分離、用語明確化、output 指示緩和、\_\_time ローカルタイム対応
- Updated dependencies [c2ba74f]
- Updated dependencies [afe7be5]
  - @modular-prompt/driver@0.10.2

## 0.3.0

### Minor Changes

- e2f5700: feat: agenticProcess をジェネリクス化し、コンテキスト型を整理

  - `agenticProcess<T>` — ユーザーは任意のコンテキスト型でモジュールの DynamicContent を解決可能に
  - `AgenticWorkflowContext` から `objective` と `inputs` を削除（内部専用に）
  - `AgenticResumeState` を新設 — ワークフロー再開用の型（`taskList`, `executionLog`, `state`）
  - 再開は `options.resumeState` で渡す方式に変更
  - `inputs` セクションは `userModule.inputs` を参照するように修正

### Patch Changes

- 0b2eeb6: agentic workflow: タスク指示・出力制御の改善

  - 疑似 think タグにタスク指示文を記載 [taskType: instruction] 形式
  - taskCommon に担当外作業の抑制と不可能時の報告指示を追加
  - planning のタスク指示文ガイダンスを調整
  - タスクタイプごとの maxTokens 3 段階制御 (low/middle/high)
  - タスク実行結果を materials から preparationNote に移動
  - planning の toolChoice を required から auto に変更

## 0.2.2

### Patch Changes

- 5590292: agentic workflow: 外部ツール呼び出し時にタスクループを即停止、タスク指示の改善

## 0.2.1

### Patch Changes

- 47b9eda: PromptModule に persona セクション追加、agentic workflow に state 伝播と\_\_update_state ツール追加
- Updated dependencies [47b9eda]
  - @modular-prompt/core@0.2.1
  - @modular-prompt/driver@0.10.1
  - @modular-prompt/utils@0.3.1

## 0.2.0

### Minor Changes

- 6d01df5: agentic-workflow の actions/ActionHandler を tool calling API に置き換え

  - ToolSpec 型（ToolDefinition + handler）を導入
  - execution フェーズに tool calling loop を実装
  - agent-workflow（簡易版）を削除
  - TestDriver に toolCalls サポート追加
  - experiment dynamic-loader の.ts モジュールファイル対応

- 749e29e: agentic workflow の改善: タスクベース・tool calling 方式への再設計、プロンプト品質向上、insertAt 順序修正
- fec7974: ワークフローで DriverSet（役割別ドライバー）を受け取れるように

  - `DriverInput` 型を追加: `AIDriver | DriverSet` のユニオン型で後方互換を維持
  - `ModelRole` 型: `default`, `thinking`, `instruct`, `chat`, `plan` の 5 種類
  - `resolveDriver()` ヘルパー: 役割に応じたドライバー解決（フォールバック付き）
  - 全 8 ワークフロー関数の第 1 引数を `DriverInput` に変更

- 0698360: stream/concat ワークフローに内部モジュールを自動 merge

  - `streamProcess`: 既存の `streamProcessing` モジュールを自動 merge
  - `concatProcess`: 新規 `concatProcessing` モジュールを作成し自動 merge

### Patch Changes

- Updated dependencies [6d01df5]
- Updated dependencies [749e29e]
  - @modular-prompt/driver@0.10.0
  - @modular-prompt/core@0.2.0
  - @modular-prompt/utils@0.3.0

## 0.1.28

### Patch Changes

- Updated dependencies [a732958]
  - @modular-prompt/driver@0.9.3

## 0.1.27

### Patch Changes

- Updated dependencies [b57fcec]
- Updated dependencies [708f42c]
  - @modular-prompt/driver@0.9.2

## 0.1.26

### Patch Changes

- Updated dependencies [fbf6055]
  - @modular-prompt/driver@0.9.1

## 0.1.25

### Patch Changes

- Updated dependencies [d78df1b]
- Updated dependencies [9d23d3f]
  - @modular-prompt/driver@0.9.0

## 0.1.24

### Patch Changes

- 4b476dc: defaultProcess ワークフローの追加

  - compile + driver.query()の最小ワークフロー
  - 全プロセスの基本形として使用

- Updated dependencies [23886fc]
  - @modular-prompt/driver@0.8.2

## 0.1.23

### Patch Changes

- Updated dependencies [64ab1f7]
- Updated dependencies [2fb9371]
- Updated dependencies [9831ef7]
  - @modular-prompt/core@0.1.13
  - @modular-prompt/driver@0.8.1

## 0.1.22

### Patch Changes

- Updated dependencies [be3037c]
  - @modular-prompt/driver@0.8.0

## 0.1.21

### Patch Changes

- Updated dependencies [68c1ead]
  - @modular-prompt/driver@0.7.0

## 0.1.20

### Patch Changes

- Updated dependencies [866051c]
- Updated dependencies [1c8c8db]
  - @modular-prompt/driver@0.6.3
  - @modular-prompt/core@0.1.12

## 0.1.19

### Patch Changes

- Updated dependencies [835a9b9]
  - @modular-prompt/core@0.1.11
  - @modular-prompt/driver@0.6.2

## 0.1.18

### Patch Changes

- Updated dependencies [f17538c]
  - @modular-prompt/driver@0.6.1

## 0.1.17

### Patch Changes

- Updated dependencies [e0117fc]
  - @modular-prompt/driver@0.6.0

## 0.1.16

### Patch Changes

- Updated dependencies [50c66af]
  - @modular-prompt/driver@0.5.2

## 0.1.15

### Patch Changes

- Updated dependencies [84ac5c8]
  - @modular-prompt/driver@0.5.1

## 0.1.14

### Patch Changes

- Updated dependencies [9a7660e]
  - @modular-prompt/driver@0.5.0

## 0.1.13

### Patch Changes

- @modular-prompt/driver@0.4.7

## 0.1.12

### Patch Changes

- cac4dab: リネーム後のクリーンアップ

  - prepublishOnly スクリプトを修正（npm run → pnpm run）
  - リポジトリ URL を新しい名前に更新（moduler-prompt → modular-prompt）
  - experiment パッケージのビルド出力構造を修正（dist/src/ → dist/）
  - パッケージ説明文の修正

- Updated dependencies [cac4dab]
  - @modular-prompt/core@0.1.10
  - @modular-prompt/driver@0.4.6

## 0.1.11

### Patch Changes

- Updated dependencies [d85ab2d]
  - @modular-prompt/driver@0.4.5

## 0.1.10

### Patch Changes

- Updated dependencies [afd3c40]
  - @modular-prompt/core@0.1.9
  - @modular-prompt/driver@0.4.4

## 0.1.9

### Patch Changes

- Updated dependencies [9090829]
  - @modular-prompt/driver@0.4.3
