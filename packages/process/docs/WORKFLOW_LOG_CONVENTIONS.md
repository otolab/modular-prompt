# ワークフローログ規約

ワークフロー実装者向けの Logger 使用規約。
Logger の仕様詳細については [UTILITIES.md](../../../docs/UTILITIES.md) を参照してください。

## 概要

`@modular-prompt/process` パッケージのワークフロー関数は、`@modular-prompt/utils` の Logger を使用して実行ログを記録します。この規約は、ワークフロー実装者が一貫した方法でログを出力するためのガイドラインです。

## context 命名規則

ワークフロー関数は Logger インスタンスの `context` 名で自身を識別します。

### 基本形

```
{workflow名}
```

**例:**
- `default`
- `stream`
- `agentic`

### 階層形

複雑なワークフロー（複数の処理単位を持つもの）では、階層的な context を使用します。

```
{workflow名}:{区分}:{識別子}:{タイプ}
```

**例:**
- `agentic:task:1:planning`
- `agentic:task:2:think`
- `agentic:task:3:outputMessage`

**規則:**
- 階層の区切りは `:` を使用
- 階層の深さはワークフローが自由に決定可能
- 各階層の意味はワークフローが定義

## メッセージ prefix 規則

ログメッセージの先頭に `[tag]` を付与して、エントリの種別を示します。

| prefix | 意味 | 内容 |
|--------|------|------|
| `[start]` | 処理単位の開始 | 説明テキスト |
| `[end]` | 処理単位の完了 | なし、または所要時間等 |
| `[prompt]` | ドライバーに送るプロンプト | CompiledPrompt の JSON |
| `[output]` | ドライバーからの応答 | 応答テキスト |
| `[tool:call]` | ツール呼び出し要求 | ツール名と引数 |
| `[tool:result]` | ツール呼び出し結果 | ツール名と結果 |

**注意:**
- prefix のないメッセージは自由記述とします
- prefix は必ず角括弧 `[]` で囲みます
- prefix と本文の間にスペースを入れます

## ログレベルの使い分け

| レベル | 用途 | 使用例 |
|--------|------|--------|
| `info` | 処理の進行状況 | `[start]`, `[end]` |
| `verbose` | 入出力の内容 | `[prompt]`, `[output]` |
| `debug` | 詳細情報 | `[tool:call]`, `[tool:result]`、内部状態 |

## ワークフロー実装の責務

ワークフロー実装者は以下を実装する必要があります:

### 1. Logger インスタンスの作成

モジュールスコープで `new Logger({ context: '...' })` を作成します。

```typescript
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ context: 'myWorkflow' });
```

### 2. 処理単位の開始・完了ログ

処理単位の開始時に `[start]` を、完了時に `[end]` を出力します。

```typescript
logger.info('[start] Processing workflow');
// ... 処理 ...
logger.info('[end] Workflow completed');
```

### 3. ドライバー呼び出しのログ

ドライバー呼び出しの前後で `[prompt]` と `[output]` を出力します。

```typescript
const compiledPrompt = compile(module, context);
logger.verbose('[prompt]', JSON.stringify(compiledPrompt, null, 2));

const result = await driver.query(compiledPrompt);
logger.verbose('[output]', result.output);
```

### 4. ツール呼び出しのログ

ツール呼び出しがある場合は `[tool:call]` と `[tool:result]` を出力します。

```typescript
logger.debug('[tool:call]', toolName, JSON.stringify(args));
const toolResult = await executeTool(toolName, args);
logger.debug('[tool:result]', toolName, JSON.stringify(toolResult));
```

### 5. 階層化された Logger の作成（必要な場合）

階層化が必要な場合（agenticProcess のタスクなど）は、context を切り替えた Logger インスタンスを作成します。

```typescript
const baseLogger = new Logger({ context: 'agentic' });

// タスク 1 用の Logger
const task1Logger = baseLogger.context(`task:1:planning`);
task1Logger.info('[start] Planning task');

// タスク 2 用の Logger
const task2Logger = baseLogger.context(`task:2:think`);
task2Logger.info('[start] Think task');
```

## trace 側の責務

trace 機能（Logger の蓄積機能を利用する側）は以下の責務を持ちます:

- Logger の蓄積機能でエントリを収集する
- context でグループ化してファイルに書き出す
- ファイル形式やディレクトリ構造は trace 側が決定する

**重要**: ワークフロー側は trace の存在を知りません。ワークフロー実装者は Logger にログを出力するだけで、trace 機能の実装や設定については関知しません。

## 実装例

### シンプルなワークフロー

```typescript
import { Logger } from '@modular-prompt/utils';
import { compile } from '@modular-prompt/core';

const logger = new Logger({ context: 'simple' });

export async function simpleProcess(
  driver: AIDriver,
  module: PromptModule,
  context: Context
): Promise<QueryResult> {
  logger.info('[start] Simple workflow');

  const compiledPrompt = compile(module, context);
  logger.verbose('[prompt]', JSON.stringify(compiledPrompt, null, 2));

  const result = await driver.query(compiledPrompt);
  logger.verbose('[output]', result.output);

  logger.info('[end] Simple workflow completed');
  return result;
}
```

### 階層化されたワークフロー

```typescript
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ context: 'agentic' });

export async function agenticProcess(
  driver: AIDriver,
  module: PromptModule,
  context: Context
): Promise<QueryResult> {
  logger.info('[start] Agentic workflow');

  const tasks = [
    { id: 1, type: 'planning' },
    { id: 2, type: 'think' },
  ];

  for (const task of tasks) {
    const taskLogger = logger.context(`task:${task.id}:${task.type}`);
    taskLogger.info('[start]', `Task ${task.id}: ${task.type}`);

    // タスク実行
    const result = await executeTask(driver, task);
    taskLogger.verbose('[output]', result.output);

    taskLogger.info('[end]', `Task ${task.id} completed`);
  }

  logger.info('[end] Agentic workflow completed');
  return finalResult;
}
```

## 関連ドキュメント

- [UTILITIES.md](../../../docs/UTILITIES.md) - Logger の詳細仕様
- [agentic-workflow/DESIGN.md](../src/workflows/agentic-workflow/DESIGN.md) - Agentic Workflow v2 の設計文書（階層化されたログの実例）
