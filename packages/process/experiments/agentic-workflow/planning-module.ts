/**
 * Agentic Workflow v2 - Planning タスクタイプ (実験用モジュール)
 *
 * 2つのモードで使用可能:
 * - USE_SOURCE_MODULES=true: ソースコードの taskCommon/planningModule を使用
 * - USE_SOURCE_MODULES=false: このファイル内のテスト用定義を使用（日本語版）
 */

import { merge } from '@modular-prompt/core';
import type { PromptModule, MaterialElement } from '@modular-prompt/core';

// ---------------------------------------------------------------------------
// モード切り替え: true でソースコードのモジュールを使用
// ---------------------------------------------------------------------------
const USE_SOURCE_MODULES = true;

// ---------------------------------------------------------------------------
// Context型定義
// ---------------------------------------------------------------------------

interface PlanningContext {
  userModule: {
    objective: string[];
    terms?: string[];
    instructions?: string[];
    guidelines?: string[];
  };
  inputs?: Record<string, unknown>;
  materials?: MaterialElement[];
  taskList?: { id: number; description: string; taskType: string }[];
  currentTaskIndex?: number;
  state?: string;
}

// ---------------------------------------------------------------------------
// userModule: experiment context から objective/terms を取得
// ---------------------------------------------------------------------------

function extractTextFromSection(section: string[] | undefined): string {
  if (!section) return '';
  return section.filter((item) => typeof item === 'string').join('\n');
}

const userModule: PromptModule<PlanningContext> = {
  objective: [
    (ctx: PlanningContext) => ctx.userModule.objective || '',
  ],
  terms: [
    (ctx: PlanningContext) => ctx.userModule.terms || null,
  ],
};

// ===========================================================================
// テスト用定義（日本語版）
// USE_SOURCE_MODULES=false のとき使用
// ===========================================================================

function buildTaskListDisplay(ctx: PlanningContext): string {
  if (!ctx.taskList || ctx.taskList.length === 0) {
    return 'まだタスクは登録されていません。';
  }
  const currentIndex = ctx.currentTaskIndex ?? -1;
  return ctx.taskList.map((task, i) => {
    const status = i < currentIndex ? '[完了]' : i === currentIndex ? '[現在]' : '[未着手]';
    return `- タスク ${task.id} (${task.taskType}): ${task.instruction} ${status}`;
  }).join('\n');
}

const testTaskCommon: PromptModule<PlanningContext> = {
  terms: [
    '- Objective: 最終的に解決すべき目標',
    '- Plan: Objectiveを解決するためのTaskのフロー',
    '- Task: AIが実行する作業単位'
  ],
  methodology: [
    '- このワークフローは、タスクを順次実行することで目標を達成します',
    '- あなたが担当する現在のTaskを把握し、Instructionsの指示に従ってください',
    {
      type: 'subsection' as const,
      title: '現在のタスク',
      items: [
        (ctx: PlanningContext) => {
          const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
          if (!task) return '現在のタスクなし';
          return `${task.taskType}: ${task.instruction}`;
        },
      ],
    },
    {
      type: 'subsection' as const,
      title: '現在のタスクリスト',
      items: [
        (ctx: PlanningContext) => buildTaskListDisplay(ctx),
      ],
    },
  ],
  state: [
    (ctx: PlanningContext) => {
      return ctx.state || '(保存された状態なし)';
    },
  ],
};

const testPlanningModule: PromptModule<PlanningContext> = {
  objective: [
    '',
    '- 以上の目標を達成するためのプランを作成・更新してください',
  ],
  instructions: [
    '- 目的を達成するためのプランを策定し、`__insert_tasks` ツールでワークフローにタスクを挿入します',
    '- 『分解すべき指示』『遵守すべきガイドライン』『Materials』『Inputs』を把握し、具体的な指示を作成してください',
    {
      type: 'subsection' as const,
      title: '計画の立て方',
      items: [
        '1. **複雑さの評価**: 目標と利用可能な情報を考慮します。単純な目標なら出力前に1タスクで十分な場合もあります。複雑な目標には複数のステップが必要です。',
        '2. **必要なアクションの特定**: どの情報を収集する必要があるか？どの分析が必要か？どのツールを呼び出す必要があるか？',
        '3. **タスク順序の設計**: 各タスクが前のタスクの結果を活用できるように順序を決めます。',
        '4. **タスクの挿入**: `__insert_tasks` を呼び出し、タスクをワークフローに挿入します。',
      ],
    },
  ],

  materials: [
    (ctx: PlanningContext) => {
      const text = extractTextFromSection(ctx.userModule?.instructions);
      if (!text) return null;
      return {
        type: 'material' as const,
        id: 'user-instructions',
        title: '分解すべき指示',
        content: text,
      };
    },
    (ctx: PlanningContext) => {
      const text = extractTextFromSection(ctx.userModule?.guidelines);
      if (!text) return null;
      return {
        type: 'material' as const,
        id: 'user-guidelines',
        title: '遵守すべきガイドライン',
        content: text,
      };
    },
    (ctx: PlanningContext) => {
      if (!ctx.materials?.length) return null;
      return ctx.materials;
    },
  ],

  inputs: [
    (ctx: PlanningContext) => {
      if (!ctx.inputs) return null;
      return JSON.stringify(ctx.inputs, null, 2);
    },
  ],

  cue: [
    {
      type: 'message' as const,
      role: 'user' as const,
      content: '`__insert_tasks` を呼び出し、ワークフローにタスクを挿入してください。',
    },
  ],
};

// ===========================================================================
// モジュール組み立て
// ===========================================================================

let module: PromptModule<PlanningContext>;

if (USE_SOURCE_MODULES) {
  // ソースコードのモジュールを使用
  const { taskCommon, getTaskTypeConfig } = await import('@modular-prompt/process');
  const planningConfig = getTaskTypeConfig('planning');
  module = merge(userModule, taskCommon, planningConfig.module);
} else {
  // テスト用定義を使用（日本語版）
  module = merge(userModule, testTaskCommon, testPlanningModule);
}

export default module;
