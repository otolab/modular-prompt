# プロセスモジュールの基本形

## はじめに

プロセスモジュールは、ワークフロー処理で再利用されるPromptModuleの一種です。

PromptModuleフレームワーク自体は標準セクションの使い方を強制しません。しかし、プロセスモジュールとして異なるワークフロー間で再利用するためには、セクションの使い方に一貫性が必要です。このドキュメントでは、プロセスモジュールにおける標準セクションとContextフィールドの使い方のガイドラインを示します。

プロセスモジュールは以下の責任を持ちます：

1. **Contextの型を定義する** - 処理に必要なデータ構造を規定
2. **Contextからセクションへの変換を定義する** - データをプロンプトの各セクションに配置
3. **処理方法を定義する** - methodology, termsで処理手順を指示
4. **ユーザーモジュールとマージされる** - ユーザーの目的・指示と統合

## ワークフロー関数とDriverInput

すべてのワークフロー関数（`defaultProcess`、`streamProcess`、`concatProcess`、`agenticProcess`等）は第1引数として `DriverInput` 型を受け入れます。

### DriverInput型

```typescript
type DriverInput = AIDriver | DriverSet;
```

- **AIDriver**: 単一のドライバーインスタンス（従来通りの使い方）
- **DriverSet**: 役割別に異なるドライバーを指定するオブジェクト

### DriverSet型

```typescript
type ModelRole = 'default' | 'thinking' | 'instruct' | 'chat' | 'plan';
type DriverSet = { default: AIDriver } & { [K in Exclude<ModelRole, 'default'>]?: AIDriver };
```

`default` は必須で、それ以外の役割はオプションです。未指定の役割は自動的に `default` にフォールバックします。

### 使用例

```typescript
// 単一ドライバー（後方互換）
const result = await streamProcess(driver, module, context);

// 役割別ドライバー
const driverSet: DriverSet = {
  default: fastDriver,
  thinking: reasoningDriver,
  chat: chatOptimizedDriver
};
const result = await streamProcess(driverSet, module, context);
```

ワークフロー内部では `resolveDriver(input, role)` ヘルパーを使用して、役割に応じたドライバーを解決します。

## 1. プロンプトとセクションの意味づけ

標準セクションは使われ方の想定がそれぞれ異なり、ユーザーモジュールで定義されるものとプロセスモジュールで定義されるものに分けられます。

### Instructionsセクション（指示）

| セクション | セクションタイトル | 想定される定義元 | 用途 |
|---------|------------------|--------------|------|
| objective | 'Objective and Role' | ユーザーモジュール | AIの目的と役割定義 |
| persona | 'Persona and Character' | ユーザーモジュール | AIの人格・キャラクター設定（信念・目標・感情・価値観・立場・コミュニケーション方式） |
| terms | 'Term Explanations' | 両方 | プロンプト内で使う言葉のすべての定義 |
| methodology | 'Processing Methodology' | プロセスモジュール | 処理手法の指定 |
| instructions | 'Instructions' | ユーザーモジュール | 具体的な作業指示 |
| guidelines | 'Guidelines' | 両方 | 制約とガイドライン |
| preparationNote | 'Response Preparation Note' | プロセスモジュール | 応答準備の注意事項（2-phases用） |

### Dataセクション（データ）

| セクション | セクションタイトル | 想定される定義元 | 用途 |
|---------|------------------|--------------|------|
| state | 'Current State' | プロセスモジュール | 現在の状態情報（Contextから生成） |
| materials | 'Prepared Materials' | プロセスモジュール | 構造化された参考資料（Contextから生成） |
| inputs | 'Input Data' | プロセスモジュール | シンプルな入力データ（Contextから生成） |
| chunks | 'Input Chunks' | プロセスモジュール | 分割された大量データ（Contextから生成または分割） |
| messages | 'Messages' | プロセスモジュール | 対話履歴（Contextから生成） |

**注記**: Dataセクションは、プロセスモジュールがContext内のデータを取り出して配置します。

#### Dataセクションの構造

各Dataセクションは特定の構造を期待します：

**state**: `{content: string, usage?: number}`形式

**inputs**: 各プロセスモジュールがContext型で構造を定義。inputsセクションに配置する際は文字列に変換（通常はJSON.stringify）

**materials**: MaterialElement配列
```typescript
{
  type: 'material',
  id: string,        // 一意の識別子
  title: string,     // 資料のタイトル
  content: string,   // 資料の内容
  usage?: number     // トークン使用量（オプション）
}
```

**chunks**: ChunkElement配列
```typescript
{
  type: 'chunk',
  partOf: string,    // 全体のどの部分か（例: 'execution-results'）
  index: number,     // チャンクの位置（1から開始）
  total: number,     // 全チャンク数
  content: string    // チャンクの内容
}
```

**messages**: MessageElement配列
```typescript
{
  type: 'message',
  role: 'system' | 'assistant' | 'user',
  content: string,
  name?: string      // 話者名（オプション）
}
```

### Outputセクション（出力）

| セクション | 想定される定義元 | 用途 |
|---------|--------------|------|
| cue | プロセスモジュール | 出力開始の合図テキスト |
| schema | 両方 | JSONスキーマによる出力形式定義 |

**注記**: schemaはユーザーが出力形式を指定する場合と、プロセスが構造化出力を要求する場合があります。

## 2. プロセスモジュールの実装フロー

プロセスモジュールは以下の順序で実装されます。

### ステップ1: Contextの型定義

処理に必要なデータ構造を定義します。

```typescript
/**
 * プロセス固有のContext型を定義
 * （以下はAgentic workflowの例）
 */
export interface AgenticWorkflowContext {
  inputs?: any;                   // 入力データ
  plan?: AgenticPlan;               // 実行計画
  executionLog?: AgenticExecutionLog[];  // 実行履歴
  state?: {                       // 前ステップからの申し送り
    content: string;
    usage?: number;
  };
  currentStep?: AgenticStep;        // 現在のステップ
  actionResult?: any;             // アクション実行結果
  phase?: 'planning' | 'execution' | 'integration' | 'complete';
}
```

各プロセスモジュールは独自のContext型を定義します。多くのワークフローで使われる典型的なフィールド（inputs, materials, state）を必要に応じて使用し、プロセス固有のフィールドを追加します。

### ステップ2: プロセスモジュールの定義

ContextからセクションへのマッピングとWorkflowの処理方法を定義します。

```typescript
/**
 * プロセスモジュールの定義
 * （以下は一般的なプロセスモジュールの例）
 */
export const processModule: PromptModule<WorkflowContext> = {
  // 処理方法を定義（直接文字列で書くこともsubsectionで構造化することもできる）
  methodology: [
    'プロセス固有の処理手順を記述',
    'instructionsの中から関連する指示を実行',
    // 必要に応じてsubsectionで構造化
    {
      type: 'subsection',
      title: '詳細な処理手順',
      items: [
        'ステップ1: データを検証',
        'ステップ2: 処理を実行',
        'ステップ3: 結果を整形'
      ]
    }
  ],

  // Contextから状態を取り出してstateセクションに配置
  state: [
    (ctx) => ctx.state ? `現在の状態: ${ctx.state}` : null,
    (ctx) => `フェーズ: ${ctx.phase}`
  ],

  // Contextからデータを取り出して適切なセクションに配置
  inputs: [
    (ctx) => ctx.inputs ? JSON.stringify(ctx.inputs) : null
  ],

  // materialsセクション: Contextの生データをMaterialElement形式に変換
  materials: [
    (ctx) => {
      if (!ctx.materials || ctx.materials.length === 0) return null;

      // 生データに type: 'material' を追加して変換
      return ctx.materials.map(material => ({
        type: 'material' as const,
        id: material.id,
        title: material.title,
        content: material.content,
        usage: material.usage
      }));
    }
  ],

  // chunksセクション: ChunkElement形式に変換
  chunks: [
    (ctx) => {
      if (!ctx.executionLog) return null;
      return ctx.executionLog.map((log, index) => ({
        type: 'chunk' as const,
        partOf: 'results',
        index: index + 1,
        total: ctx.executionLog!.length,
        content: log.result
      }));
    }
  ],

  // 構造化出力の定義（必要に応じて）
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          // プロセス固有の出力スキーマ
        }
      }
    }
  ]
};
```

プロセスモジュールは以下を定義します：
- **methodology**: 処理手法の指示（文字列またはsubsectionで構造化）
- **terms**: 用語の定義・再定義（必要に応じて）
- **state/inputs/materials/chunks/messages**: Contextからデータを取り出し、各セクションが期待する構造に変換して配置
  - state: `{content, usage}`形式
  - inputs: Context型で定義された構造を文字列に変換（例: JSON.stringify）
  - materials: MaterialElement配列（`{type, id, title, content, usage?}`）
  - chunks: ChunkElement配列（`{type, partOf, index, total, content}`）
  - messages: MessageElement配列（`{type, role, content, name?}`）
- **schema**: 構造化出力の形式（必要に応じて）

### ステップ3: ワークフロー関数の実装

マージ済みモジュールとContextを受け取り、ワークフローを実行する関数を実装します。

```typescript
import type { DriverInput } from '@modular-prompt/process';

/**
 * ワークフロー関数の実装
 * （以下は単純なワークフローの例）
 */
export async function processWorkflow(
  driver: DriverInput,                    // AIDriver または DriverSet
  module: PromptModule<WorkflowContext>,  // マージ済みモジュール
  context: WorkflowContext,               // Context
  options: WorkflowOptions = {}
): Promise<WorkflowResult<WorkflowContext>> {

  // Contextからプロンプトを生成
  const prompt = compile(module, context);

  // AIドライバーで実行
  // DriverInputは単一のAIDriverまたは役割別DriverSetを受け入れる
  const result = await resolveDriver(driver, 'default').query(prompt);

  // Contextを更新
  const updatedContext = {
    ...context,
    state: result.structuredOutput?.nextState || result.content
  };

  // 結果を返す
  return {
    output: result.content,
    context: updatedContext,
    metadata: {
      usage: result.usage
    }
  };
}
```

**DriverInput型について:**

ワークフロー関数の第1引数は `DriverInput = AIDriver | DriverSet` 型です。これにより、以下のいずれかを受け入れることができます:

- **単一のAIDriver**: 従来通りの使い方（後方互換）
- **DriverSet**: 役割別に異なるドライバーを指定 `{ default: AIDriver, thinking?: AIDriver, chat?: AIDriver, ... }`

役割に応じたドライバーを解決するには、`resolveDriver(input, role)` ヘルパーを使用します。未指定の役割は自動的に `default` にフォールバックします。

### ステップ4: 使用例

```typescript
import { merge, createContext } from '@modular-prompt/core';
import { processModule, processWorkflow } from './my-process';

// 1. ユーザーモジュール（タスク定義）
const userModule = {
  objective: ['データを分析してレポートを作成する'],
  instructions: [
    'データの傾向を分析',
    '重要なポイントを抽出',
    '結果をまとめる'
  ]
};

// 2. マージしてContext型を確定
const mergedModule = merge(processModule, userModule);

// 3. マージ済みモジュールからContextを生成
const context = createContext(mergedModule);
// contextは自動的にマージされた型を持つ

// 必要に応じてcontextのフィールドを設定
context.inputs = { data: [...] };
context.materials = [
  { id: 'ref1', title: '参考資料', content: '...' }
];

// 4. 実行
const result = await processWorkflow(driver, mergedModule, context);
```

**重要なポイント:**
- ワークフロー関数はマージ済みモジュールを受け取ります
- マージはユーザー側で行い、`createContext(mergedModule)`で型安全なContextを取得します
- 複雑なワークフロー（dialogueなど）では複数フェーズに分かれることもあります

## 3. Contextのスキーマ基本形

### 3.1 典型的なフィールド構造

多くのワークフローで使われる典型的なフィールド構造：

```typescript
/**
 * 多くのワークフローで使われる典型的なフィールド
 * 注: これは「共通の基底型」として定義されているわけではなく、
 *     多くのワークフローで同じような構造が使われているという観察結果
 */
interface TypicalWorkflowContext {
  // 処理状態
  state?: {
    content: string;   // 現在の状態、中間結果
    usage?: number;    // トークン使用量（オプション）
  };

  // 分割データ
  chunks?: Array<{
    content: string;   // チャンクの内容
    partOf?: string;   // 全体のどの部分か
    usage?: number;    // トークン使用量
    metadata?: any;    // 追加メタデータ
  }>;

  // 処理範囲（バッチ処理で使用）
  range?: {
    start?: number;    // 開始インデックス
    end?: number;      // 終了インデックス
  };
}
```

**注記**: 共通のフィールドが多いほど予約語が少なくて済むため、可能な限り既存のパターンを再利用することが推奨されます。

### 3.2 フィールドの責任分担

#### 典型的にユーザーが設定するフィールド

多くのプロセスモジュールで想定されるユーザー提供データ（プロセスごとに異なります）：

| フィールド | 用途 |
|----------|------|
| inputs | 入力データ（各プロセスが期待する構造） |
| materials | 参考資料（構造化された資料） |
| state | 初期状態（処理開始時の状態や継続情報） |

**注記**: `inputs`の構造は各プロセスモジュールが定義します（例：dialogueでは`messages`配列、agenticでは任意のデータ）

#### ワークフロー内部管理フィールド

プロセス内部で使用される予約済みフィールド（ワークフローが生成・更新）：

| カテゴリ | フィールド | 配置先セクション | 用途 |
|---------|----------|---------|------|
| **共通** | state | state | 処理状態の引き継ぎ |
| | chunks | chunks | 分割データ（実行結果など） |
| | phase | state | 処理フェーズ |
| | range | （配置なし） | バッチ処理の範囲指定 |
| **Agentic** | plan | materials | 実行計画 |
| | executionLog | chunks | 実行履歴 |
| | currentStep | state | 現在のステップ |
| | actionResult | materials | アクション実行結果 |
| **Dialogue** | messages | messages | 対話履歴 |
| | preparationNote | preparationNote | 応答準備の注意事項 |
| **Summarize** | targetTokens | state | 目標トークン数 |
| | analysisReport | materials | 分析レポート |

**注記**: `state`、`chunks`、`messages`はユーザーが初期値を設定でき、ワークフローが更新する特殊なフィールドです

### 3.3 ワークフロー固有のContext定義例

各ワークフローは独自のContext型を定義します。典型的なフィールド（state, chunks, rangeなど）を必要に応じて使用し、ワークフロー固有のフィールドを追加します：

```typescript
// 対話ワークフロー
interface DialogueWorkflowContext {
  inputs?: Array<{  // dialogueではmessages配列を想定
    content: string;
    role: 'system' | 'assistant' | 'user';
    name?: string;
  }>;
  messages?: Array<{...}>;  // ワークフローが管理
  preparationNote?: {
    content: string;
  };
  state?: { content: string; usage?: number };
}

// 要約ワークフロー
interface SummarizeWorkflowContext {
  inputs?: any;
  targetTokens?: number;
  analysisReport?: string;
  phase?: 'analysis' | 'summarization' | 'complete';
  state?: { content: string; usage?: number };
  chunks?: Array<{...}>;
  range?: { start?: number; end?: number };
}

// エージェントワークフロー
interface AgenticWorkflowContext {
  inputs?: any;
  state?: { content: string; usage?: number };
  plan?: AgenticPlan;
  executionLog?: AgenticExecutionLog[];
  currentStep?: AgenticStep;
  actionResult?: any;
  phase?: 'planning' | 'execution' | 'integration' | 'complete';
}
```

## 4. 使用上の制約

### 4.1 stateフィールドの使い方

**推奨:**
```typescript
state: {
  content: '処理中間結果や申し送り事項',
  usage: 1500
}
```

**非推奨:**
```typescript
state: '文字列のみ'  // 拡張性がない
```

### 4.2 chunksセクションの使い方

chunksセクションには分割データを配置します：

- ユーザーが提供する大量データをプロセスが分割する場合
- プロセス内部で生成された複数の結果を配置する場合

**注記**: ワークフロー内部生成物の具体的な配置方法（chunksかstateか、Contextフィールド名など）はまだ統一されていません。各プロセスモジュールの実装を参照してください。

### 4.3 materialsセクションの使い方

- ユーザーはContextの`materials`フィールドに参考資料を提供
- プロセスモジュールがそれを`materials`セクションに配置

## 5. ベストプラクティス

1. **Contextフィールドとセクションを区別する**: ユーザーはContextにデータを提供、プロセスモジュールがセクションに配置
2. **stateは構造化する**: `{content, usage}`形式を使用
3. **Contextフィールドの責任を明確にする**: データ提供元（ユーザー/ワークフロー）を明確に
4. **chunksとmaterialsを適切に使い分ける**:
   - `materials`: 参考資料（Contextの`materials`フィールドから）
   - `chunks`: 分割データ（Contextの`chunks`または`executionLog`などから）
5. **rangeでバッチ処理**: 大量データは範囲指定で段階的に処理
6. **schemaの衝突に注意**: プロセスとユーザーのschemaが競合する可能性

