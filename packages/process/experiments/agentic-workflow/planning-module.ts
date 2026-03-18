/**
 * Agentic Workflow v2 - Planning タスクタイプ (実験用モジュール)
 *
 * 2つのモードで使用可能:
 * - USE_SOURCE_MODULES=true: ソースコードの taskCommon/planningModule を使用
 * - USE_SOURCE_MODULES=false: このファイル内のテスト用定義を使用（日本語版）
 */

import { merge, distribute } from '@modular-prompt/core';
import type { PromptModule, MaterialElement } from '@modular-prompt/core';
import { formatCompletionPrompt } from '@modular-prompt/driver';

// ---------------------------------------------------------------------------
// モード切り替え: true でソースコードのモジュールを使用
// ---------------------------------------------------------------------------
const USE_SOURCE_MODULES = true;

// ---------------------------------------------------------------------------
// Context型定義
// ---------------------------------------------------------------------------

interface PlanningContext {
  userModule: Record<string, any>;
  inputs?: Record<string, unknown>;
  materials?: MaterialElement[];
  taskList?: { instruction: string; taskType: string }[];
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
    const status = i < currentIndex ? '[completed]' : i === currentIndex ? '[current]' : '[pending]';
    return `${i + 1}. (${task.taskType}): ${task.instruction} ${status}`;
  }).join('\n');
}

const testTaskCommon: PromptModule<PlanningContext> = {
  methodology: [
    '- このワークフローは、タスクを順次実行することで目標を達成します',
    {
      type: 'subsection' as const,
      title: '現在のタスクリスト',
      items: [
        (ctx: PlanningContext) => buildTaskListDisplay(ctx),
      ],
    },
  ],
};

const testPlanningModule: PromptModule<PlanningContext> = {
  objective: [
    '与えられた指示文を分析し、複雑さを抽出してタスクを組み立てる',
  ],
  materials: [
    (ctx: PlanningContext) => {
      if (!ctx.userModule) return null;
      const compiled = distribute(ctx.userModule);
      const text = formatCompletionPrompt(compiled, {
        sectionDescriptions: {},
      });
      if (!text.trim()) return null;
      return {
        type: 'material' as const,
        id: 'user-prompt',
        title: 'Prompt to analyze',
        content: text,
      };
    },
  ],
  instructions: [
    '- "Prompt to analyze" に示された指示文を分析し、実行に必要なタスクを設計してください',
    '- `__insert_tasks` ツールを呼び出し、全タスクをまとめて登録してください',
    '- 各タスクには「何に注意すべきか」「何をすべきか」だけを簡潔に指示してください',
    '- 各タスクはそれまでに実行された処理結果をすべて受け取ります',
    '- ツール呼び出しは各タスクから行うことができますが、ツールの結果はその次のタスクが受け取ります',
    {
      type: 'subsection' as const,
      title: '分析の観点',
      items: [
        '1. **入力と出力**: 最終的に何が必要か、何が与えられているか把握',
        '2. **複雑さの特定**: 指示文のどの部分が複雑で、分割が必要か',
        '3. **依存関係**: どの情報が先に必要で、どの順序で処理すべきか',
        '4. **ツール利用**: ツールの呼び出しが必要な箇所はどこか',
      ],
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
      content: '指示文を分析し、`__insert_tasks` でタスクを登録してください。',
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
