/**
 * Agentic Workflow v2 - Planning タスクタイプのプロンプトテスト用
 *
 * getTaskTypeConfig('planning').buildModule() で生成されるプロンプトを
 * defaultProcess 経由でテストする。
 * input: { objective, inputs?, taskList?, currentTaskIndex?, executionLog? }
 */
import { getTaskTypeConfig } from '@modular-prompt/process';

const planningConfig = getTaskTypeConfig('planning');

const userModule = {
  objective: [
    (ctx) => ctx.objective || '与えられた目標を達成するための実行計画を作成してください。',
  ],
  instructions: [
    (ctx) => ctx._instructions || null,
  ],
};

// defaultProcess は compile(module, context) を実行するので、
// buildModule の結果をそのまま返す動的モジュールを作る
const module = {
  objective: [(ctx) => {
    // buildModule を呼んでプロンプトを構築
    // ただし defaultProcess は module を compile するだけなので、
    // ここでは静的にプロンプト構造を返す
    return ctx.objective || '実行計画を作成してください';
  }],

  // planning タスクタイプのプロンプトを動的に構築
  methodology: [
    (ctx) => {
      const taskList = ctx.taskList || [
        { id: 1, description: 'Planning', taskType: 'planning' },
        { id: 2, description: 'Output', taskType: 'outputMessage' },
      ];
      const currentIndex = ctx.currentTaskIndex ?? 0;
      const lines = taskList.map((t, i) => {
        const status = i < currentIndex ? '[completed]' : i === currentIndex ? '[current]' : '[pending]';
        return `- Task ${t.id} (${t.taskType}): ${t.description} ${status}`;
      });
      return `**Current Phase: Planning**\n\nTask List:\n${lines.join('\n')}`;
    },
    '',
    '- Generate an execution plan by breaking down the Objective and Instructions into 3-5 executable tasks.',
    '- Register each task using the `__task` tool provided.',
  ],

  instructions: [
    {
      type: 'subsection',
      title: 'Planning Requirements',
      items: [
        '- Break down the **Instructions shown in materials** into 3-5 concrete executable tasks',
        '- Register each task using the `__task` tool',
        '- Each task must have: description, taskType',
        '- The tasks should accomplish the Instructions in a logical sequence',
        '- Ensure logical flow between tasks',
      ],
    },
  ],

  inputs: [(ctx) => (ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null)],

  cue: [
    'Register your execution plan by calling the __task tool for each step.',
  ],
};

export default module;
