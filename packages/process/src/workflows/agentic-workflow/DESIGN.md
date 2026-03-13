# Agentic Workflow v2 設計

## 基本構造

固定フェーズを廃止し、**タスクのシーケンス**で構成する。
各タスクタイプが独自の入出力契約（何を指示として受け取り、何をデータとして受け取るか）を持つ。

```
[planning] → [task-1] → [task-2] → ... → [outputXxx]
```

## ブートストラップ

初期タスクリストはプログラム的に決定する:

- `schema` あり: `[planning, outputStructured]`
- `schema` なし: `[planning, outputMessage]`

`planning` タスクが `__task` ツールで中間タスクを挿入する。
挿入位置のデフォルトは output タスクの直前。

## タスク定義

```typescript
type TaskType =
  | 'planning'
  | 'think'
  | 'extractContext'
  | 'outputMessage'
  | 'outputStructured';

interface AgenticTask {
  id: number;                    // 自動採番（1, 2, 3, ...）
  description: string;
  taskType: TaskType;
  driverRole?: ModelRole;        // デフォルトはタスクタイプによる
  withInputs?: boolean;          // ctx.inputs を渡す
  withMessages?: boolean;        // ctx.messages を渡す
  withMaterials?: boolean;       // ctx.materials を渡す
}
```

- `id` はプログラム的に自動採番する。LLMは指定しない。
- `guidelines` / `constraints` は廃止。`description` でタスクを説明する。

## 共通原則

全タスクで共通の入力:

| 区分 | 項目 |
|------|------|
| **指示** (instructions) | `objective`, `terms`, タスクタイプ固有プロンプト |
| **データ** (data) | 前タスク結果（常に渡す） |

`objective` は大目標であり、全タスクに指示として渡す。
`terms` は語彙定義であり、全タスクに指示として渡す。

## タスクタイプ契約

### `planning`

| 区分 | 項目 |
|------|------|
| **目的** | 目標をタスクに分解し、タスクリストを構築する |
| **指示** | `objective`, `terms`, planning固有プロンプト |
| **データ** | `instructions`, `guidelines`, `materials`, `inputs` |
| **ツール** | `__task` |
| **デフォルトドライバー** | `plan` |

ユーザーModuleの `instructions`, `guidelines`, `materials`, `inputs` は
planning にとって「分析・分解すべき対象」であり、データとして渡す。

### `think`

| 区分 | 項目 |
|------|------|
| **目的** | 分析・推論 |
| **指示** | `objective`, `terms`, task description |
| **データ** | 前タスク結果 + オプション |
| **ツール** | `__task`, `__time` |
| **デフォルトドライバー** | `instruct` |

オプションとデフォルト値:
- `withInputs`: `false`
- `withMessages`: `false`
- `withMaterials`: `false`

### `extractContext`

| 区分 | 項目 |
|------|------|
| **目的** | messages / materials / inputs から情報を抽出する |
| **指示** | `objective`, `terms`, task description |
| **データ** | 前タスク結果 + オプション |
| **ツール** | `__task`, `__time` |
| **デフォルトドライバー** | `instruct` |

オプションとデフォルト値:
- `withInputs`: `true`
- `withMessages`: `true`
- `withMaterials`: `true`

### `outputMessage`

| 区分 | 項目 |
|------|------|
| **目的** | テキスト最終出力を生成する |
| **指示** | `objective`, `terms`, `cue` |
| **データ** | 全タスク結果 |
| **ツール** | なし |
| **デフォルトドライバー** | `chat` |

### `outputStructured`

| 区分 | 項目 |
|------|------|
| **目的** | schema に従った構造化データの最終出力を生成する |
| **指示** | `objective`, `terms`, `schema` |
| **データ** | 全タスク結果 |
| **ツール** | なし |
| **デフォルトドライバー** | `chat` |

## `__task` ツール

全タスクから利用可能（planning 専用ではない）。

### パラメータ

```
description: string          # 必須
taskType?: TaskType           # デフォルト: think
driverRole?: ModelRole        # デフォルト: タスクタイプによる
withInputs?: boolean          # デフォルト: タスクタイプによる
withMessages?: boolean        # デフォルト: タスクタイプによる
withMaterials?: boolean       # デフォルト: タスクタイプによる
insertAt?: number             # 挿入位置インデックス（省略時: outputタスクの直前）
```

`id` は自動採番。ツール結果として `"Task 3 registered: ..."` のように返す。

## タスクリスト表示

methodology セクションで全タスクを表示する。
フェーズ構成の説明と、現在のタスクの位置を明示する。

```markdown
## Processing Methodology

This workflow processes tasks sequentially:

- Task 1 (planning): Decompose objective into tasks [completed]
- Task 2 (think): Analyze input data [current]
- Task 3 (extractContext): Extract key points from documents [pending]
- Task 4 (outputMessage): Generate final output [pending]
```

## ドライバー割り当て

各タスクタイプにデフォルトのドライバーロールがある。
`driverRole` パラメータで上書き可能。

| タスクタイプ | デフォルト |
|------------|-----------|
| `planning` | `plan` |
| `think` | `instruct` |
| `extractContext` | `instruct` |
| `outputMessage` | `chat` |
| `outputStructured` | `chat` |

## AgenticWorkflowContext

```typescript
interface AgenticWorkflowContext {
  objective: string;
  inputs?: Record<string, unknown>;
  messages?: MessageElement[];
  materials?: MaterialElement[];
  state?: {
    content: string;
    usage?: number;
  };
  taskList?: AgenticTask[];
  executionLog?: AgenticTaskExecutionLog[];
  currentTaskIndex?: number;
}
```

注: ユーザーModuleの `instructions`, `guidelines` は Module のセクションとして渡され、
planning タスクのプロンプト構築時にデータ領域に配置される。
Context には含めない。

## ワークフローフロー

```
1. ブートストラップ
   - schema の有無に応じて初期タスクリスト生成
   - [planning, outputMessage] or [planning, outputStructured]

2. タスクループ
   for each task in taskList:
     a. タスクタイプに応じたプロンプト構築
        - 共通: objective, terms を指示側に
        - 共通: 前タスク結果をデータ側に
        - タイプ固有: 追加の指示・データ
     b. タスクタイプに応じたドライバー選択
     c. queryWithTools でクエリ（ツール提供もタイプ依存）
     d. 結果を executionLog に記録
     e. タスクリスト変更があれば反映（__task による挿入）
     f. 次のタスクへ

3. 最終出力
   - 最後のタスク（outputMessage / outputStructured）の結果が最終出力
   - pendingToolCalls がある場合は finishReason: tool_calls
```

## ファイル構成（予定）

```
agentic-workflow/
  agentic-workflow.ts      # メインワークフロー（ブートストラップ + タスクループ）
  types.ts                 # 型定義
  index.ts                 # export
  DESIGN.md                # この文書
  process/
    query-with-tools.ts    # ツール呼び出しループ（既存を調整）
    builtin-tools.ts       # __task, __time ツール定義
    format-helpers.ts      # プロンプト構築ヘルパー
  task-types/
    index.ts               # タスクタイプレジストリ
    planning.ts            # planning タスクタイプ
    think.ts               # think タスクタイプ
    extract-context.ts     # extractContext タスクタイプ
    output-message.ts      # outputMessage タスクタイプ
    output-structured.ts   # outputStructured タスクタイプ
```
