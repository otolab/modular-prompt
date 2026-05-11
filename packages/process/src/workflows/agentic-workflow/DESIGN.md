# Agentic Workflow 設計

## 概要

Agentic Workflow は、複雑なプロンプトをタスク単位に分解して実行する処理フローです。固定されたフェーズではなく、動的にタスクのシーケンスを構築し、各タスクが独立したプロンプトとして実行されます。

```
[planning] → [task-1] → [task-2] → ... → [output]
```

### 設計原則

1. **タスクベースの構成**: 固定フェーズを廃止し、タスク単位で処理を組み立てる
2. **明確な契約**: 各タスクタイプは入出力の契約（何を受け取り、何を生成するか）を持つ
3. **プランナーとワーカーの分離**: planning タスクがワークフローを設計し、他のタスクが実行する
4. **透過的な依存管理**: タスク間の依存関係をトポロジカルソートで自動解決
5. **動的な再計画**: 実行中にワークフローを見直し、タスクを再構成できる

## タスクタイプ

### タスクタイプ一覧

| タイプ | 役割 | デフォルトドライバー | maxTokens |
|--------|------|---------------------|-----------|
| `planning` | ワークフロー設計 | `plan` | high (8192) |
| `act` | 外部アクション実行 | `instruct` | low (2048) |
| `think` | 分析・推論 | `thinking` | high (8192) |
| `verify` | 検証・評価 | `thinking` | low (2048) |
| `extractContext` | 情報抽出 | `thinking` | high (8192) |
| `recall` | 情報検索 | `instruct` | middle (4096) |
| `determine` | 判断・決定 | `thinking` | middle (4096) |
| `output` | 最終出力生成 | `chat` | middle (4096) |

### タスク定義の型

```typescript
interface AgenticTask {
  name?: string;               // タスク識別子（dep 参照や表示に使用）
  instruction: string;         // このタスクが生成すべき成果物の説明
  taskType: TaskType;          // タスクタイプ
  dep?: string[];              // 依存する先行タスクの name 配列
  driverRole?: ModelRole;      // ドライバーロールの上書き
  withoutInputs?: boolean;     // ユーザー入力データを除外（デフォルト: false = 含む）
  withoutMessages?: boolean;   // ユーザーメッセージを除外（デフォルト: false = 含む）
  withoutMaterials?: boolean;  // ユーザーマテリアルを除外（デフォルト: false = 含む）
}
```

**重要な変更点**:
- `id` フィールドは廃止し、`name` に置き換え（より分かりやすく、依存関係の記述が自然）
- `dep` フィールドで依存関係を明示的に表現（トポロジカルソートで実行順序を自動決定）

## ツール体系

Agentic Workflow は二層のツール構造を持ちます。

### Planning tools（タスクタイプツール）

planning タスクから利用可能。タスクタイプ名をそのままツール名として使用します。

- `think(name, instruction, reason, ...)`: 推論タスクを登録
- `act(name, instruction, reason, ...)`: アクションタスクを登録
- `verify(name, instruction, reason, ...)`: 検証タスクを登録
- `extractContext(name, instruction, reason, ...)`: 抽出タスクを登録
- `recall(name, instruction, reason, ...)`: 検索タスクを登録
- `determine(name, instruction, reason, ...)`: 判断タスクを登録
- `output(name, instruction, reason, ...)`: 出力タスクを登録

**共通パラメータ**:
- `name` (必須): タスク識別子
- `instruction` (必須): 成果物の説明
- `reason` (必須): このタスクが必要な理由
- `dep`: 依存する先行タスクの name 配列
- `withoutInputs`, `withoutMessages`, `withoutMaterials`: データ除外フラグ
- `driverRole`: ドライバーロールの上書き
- `insertAt`: 挿入位置（省略時は次のタスクとして挿入）

### Execution tools（実行時ツール）

execution タスク（act, think, verify など）から利用可能。

- `__replan`: ワークフローの再計画を要求
- `__time`: 現在時刻を取得

### External tools

`tools` オプションで渡された外部ツール定義も、execution タスクから利用可能です。

## タスクタイプの詳細

### planning

**役割**: ユーザーリクエストを分析し、タスクシーケンスを設計する

**入力契約**:
- 指示: planning 固有のプロンプト（分析・設計の方法論）
- データ: ユーザーモジュール全体（"Original Request" として material に変換）

**出力**:
- テキスト出力: リクエスト分析の結果
- ツール呼び出し: タスクタイプツールを使ってタスクを登録

**ツール**: すべてのタスクタイプツール (`think`, `act`, ..., `output`)

**特殊処理**:
- 既存の deliverables がある場合（再計画時）、`replanningModule` がマージされ、過去の実行ログが可視化される
- planning 完了後、登録されたタスクはトポロジカルソートされる

### Execution tasks (act, think, verify, extractContext, recall, determine)

**共通の入力契約**:
- 指示: タスク固有のプロンプト + 現在タスクの `instruction` (Focus セクション)
- データ: 
  - 常に含まれる: 前タスクの deliverables
  - オプション: ユーザーの inputs, messages, materials（`without*` フラグで制御）

**共通のツール**: `__replan`, `__time`, 外部ツール

**タスクタイプ別の特徴**:

| タイプ | 目的 | 使用場面 | 成果物 |
|--------|------|----------|--------|
| `extractContext` | 情報抽出 | 入力が大量、要約が必要 | 抽出・構造化されたデータ |
| `think` | 分析・推論 | 前向きな分析、創造的作業 | 新しい洞察・生成コンテンツ |
| `verify` | 検証・評価 | 品質レビュー、妥当性評価 | 評価結果・改善提案 |
| `determine` | 判断・決定 | 意思決定、yes/no判断 | 明確な結論と根拠 |
| `act` | 外部アクション | ツール実行が主目的 | ツール実行結果 |
| `recall` | 情報検索 | 外部検索・記憶参照 | 取得した事実・ドキュメント |

### output

**役割**: 前タスクの deliverables から最終的なユーザー向け出力を生成する

**入力契約**:
- 指示: ユーザーモジュール全体 + output 固有のプロンプト
- データ: 全タスクの deliverables（state セクション経由）

**出力**: ユーザー向けの最終応答

**ツール**: なし

**特殊処理**:
- ユーザーモジュール全体が workflowBase として使われる（他のタスクは terms のみ）
- output タスクは常にワークフローの最後に配置される（トポロジカルソートで除外）

## ワークフローフロー

### 1. ブートストラップ

初期タスクリストを生成します。

- `enablePlanning=true`（デフォルト）: `[planning]` のみ。output は自動追加される
- `enablePlanning=false`: `[output]` のみ

### 2. タスクループ

各タスクを順次実行します。

```
for each task in taskList:
  1. プロンプト構築
     - タスクタイプに応じた module を merge & resolve
     - output: ユーザーモジュール全体 + outputModule
     - planning: terms のみ + planningModule (+ replanningModule)
     - 他: terms のみ + taskCommon + executionTaskModule
  
  2. ドライバー選択
     - task.driverRole または DEFAULT_DRIVER_ROLE[taskType] を使用
  
  3. queryWithTools でクエリ
     - builtin tools + external tools を提供
     - ツール呼び出しループで結果を取得
  
  4. 結果を executionLog に記録
  
  5. 特殊処理
     - planning 完了後: 新規タスクをトポロジカルソート
     - __replan 呼び出し後: 残タスクをクリアし、新しい planning タスクを挿入
     - 外部ツール pending: ワークフローを中断（finishReason: tool_calls）
     - output 完了: ワークフローを終了
```

### 3. 自動 output 追加

最後に実行されたタスクが output でなく、外部ツールも pending していない場合、output タスクが自動的に追加・実行されます。

### 4. 最終出力

- `includeThinking=false`: 最後のタスクの結果を返す
- `includeThinking=true`: 中間タスクの結果を `<think>` タグで包んで前置

## プロンプト構築の仕組み

各タスクは以下のようにプロンプトを構築します。

### planning タスク

```typescript
// workflowBase: userModule の terms のみ
// merge: workflowBase + planningModule (+ replanningModule)
// userModule 全体は "Original Request" material として提供
```

**なぜこの構造か**:
- planning は「ユーザーリクエストを分析して分解する」という meta-level の作業
- ユーザーの objective や instructions をそのまま planning の objective にすると混乱する
- したがって、ユーザーモジュールはデータとして material に変換して提供

### execution タスク

```typescript
// workflowBase: userModule の terms のみ
// merge: workflowBase + taskCommon + executionTaskModule
// userModule の inputs, messages, materials は without* フラグで制御
```

**なぜこの構造か**:
- execution タスクは「特定の deliverable を生成する」という明確な作業単位
- taskCommon で共通の methodology と state（deliverables）を提供
- executionTaskModule で Focus（現在タスクの instruction）を提供
- ユーザーデータは必要に応じて動的に含める

### output タスク

```typescript
// workflowBase: userModule 全体
// merge: workflowBase + taskCommon + outputModule
```

**なぜこの構造か**:
- output は「ユーザーの元のリクエストに対する最終応答を生成する」作業
- ユーザーモジュール全体（objective, instructions など）をそのまま使う
- deliverables は state セクション経由で提供される（taskCommon から）

## 依存関係とトポロジカルソート

### dep フィールド

タスクの `dep` フィールドは、先行タスクの `name` を配列で指定します。

```typescript
{ name: 'extract', instruction: '...', taskType: 'extractContext' }
{ name: 'analyze', instruction: '...', taskType: 'think', dep: ['extract'] }
{ name: 'decide', instruction: '...', taskType: 'determine', dep: ['analyze'] }
```

### トポロジカルソート

planning タスク完了後、新規登録されたタスクは Kahn のアルゴリズムでトポロジカルソートされます。

**特徴**:
- 依存関係のないタスクは元の順序を維持（stable sort）
- output タスクは常に最後に配置
- 循環依存を検出した場合は警告し、元の順序を保持
- 存在しない name への参照は警告し、無視

## Re-planning 機構

### `__replan` ツールの呼び出し

execution タスクから `__replan` を呼ぶと、以下の処理が行われます:

1. 現在のタスクまでの executionLog を保持
2. 残りのタスクをすべてクリア
3. 新しい planning タスクを挿入
4. planning タスクに `replanningModule` がマージされ、既存の deliverables が可視化される

### 再計画時のプロンプト

`replanningModule` は以下を提供します:

- 完了済みタスクとその結果の一覧
- "Original Request" の messages に tool result が含まれている場合の取り扱い指示

これにより、planning タスクは既存の成果を活用して新しいワークフローを設計できます。

## Resume/Suspend 機構

### AgenticResumeState

```typescript
interface AgenticResumeState {
  taskList?: AgenticTask[];
  executionLog?: AgenticTaskExecutionLog[];
}
```

### Suspend（中断）

外部ツールの呼び出しが pending のとき、ワークフローは中断されます:

```typescript
{
  output: '...',
  context: {
    taskList: [...],
    executionLog: [...],
  },
  metadata: {
    finishReason: 'tool_calls',
  },
}
```

### Resume（再開）

中断した状態を `options.resumeState` に渡すと、続きから実行されます。

## AgenticWorkflowContext

内部コンテキストの型定義:

```typescript
interface AgenticWorkflowContext {
  userModule?: ResolvedModule;      // 解決済みユーザーモジュール
  taskList?: AgenticTask[];         // 現在のタスクリスト
  executionLog?: AgenticTaskExecutionLog[];  // 実行ログ
  currentTaskIndex?: number;        // 現在実行中のタスクインデックス
  availableTools?: Array<{ name: string; description: string }>;  // planning プロンプトでの可視化用
}
```

**重要な設計変更**:
- `objective`, `inputs`, `messages`, `materials`, `state` は削除
- `userModule` が ResolvedModule として全てのユーザーデータを保持
- 各タスクのプロンプト構築時に動的に必要なデータを抽出

## MaxTokensTier

タスクタイプごとに maxTokens の tier を設定します:

```typescript
type MaxTokensTier = 'low' | 'middle' | 'high';

const MAX_TOKENS_VALUES = {
  low: 2048,
  middle: 4096,
  high: 8192,
};
```

実際の値はモデルの `maxOutputTokens` によってキャップされます（TODO: 現在は driver のデフォルトレベルのキャップのみ）。

## ファイル構成

```
agentic-workflow/
  agentic-workflow.ts          # メインワークフロー（ブートストラップ + タスクループ）
  agentic-workflow.test.ts     # ユニットテスト
  types.ts                     # 型定義（TaskType, AgenticTask, Context など）
  index.ts                     # export
  DESIGN.md                    # この文書
  prompt-inspection.test.ts    # プロンプト検証テスト
  process/
    query-with-tools.ts        # ツール呼び出しループ
    builtin-tools.ts           # planning/execution ツール定義
    format-helpers.ts          # プロンプト構築ヘルパー
    topological-sort.ts        # トポロジカルソート
    index.ts                   # export
  task-types/
    index.ts                   # タスクタイプレジストリ、共通 module (taskCommon)
    planning.ts                # planning タスクタイプ + replanningModule
    output.ts                  # output タスクタイプ
    execution-tasks.ts         # execution タスクタイプファクトリ + EXECUTION_TASK_DEFS
```

## 実装の拡張性

### 新しいタスクタイプの追加

1. `execution-tasks.ts` の `EXECUTION_TASK_DEFS` に定義を追加
2. `types.ts` の `TaskType` union に追加

レジストリ登録・ツール定義・プロンプト構築は自動的に反映されます。

### 新しいツールの追加

- Planning tools: `builtin-tools.ts` の `createPlanningTools` を修正
- Execution tools: `builtin-tools.ts` の `createExecutionBuiltinTools` を修正
- External tools: `options.tools` で渡す
