/**
 * Think task type
 *
 * Performs analysis or thinking tasks.
 *
 * Instruction side:
 * - objective (from userModule via workflowBase, + task-specific framing)
 * - terms (from taskCommon + userModule)
 * - methodology: current task, task list
 * - instructions: task.instruction
 *
 * Data side:
 * - Previous task results
 * - ctx.inputs (if withInputs=true)
 * - userModule.messages (if withMessages=true)
 * - userModule.materials (if withMaterials=true)
 *
 * Tools: __insert_tasks, __time
 */

import type { PromptModule, DynamicElement } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

const thinkModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '',
    '- You will execute the Task described in "Task Instructions" below.',
  ],

  instructions: [
    '- You will perform reasoning, analysis, or processing as instructed.',
    '- You may call external tools if needed to gather information or perform actions.',
    {
      type: 'subsection' as const,
      title: 'Task Instructions',
      items: [
        (ctx: AgenticWorkflowContext) => {
          const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
          return task?.instruction ?? '';
        },
      ],
    },
  ],

  materials: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.executionLog?.length) return null;
      return buildPreviousResultsMaterials(ctx.executionLog);
    },
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      if (!task?.withMaterials || !ctx.userModule?.materials?.length) return null;
      return ctx.userModule.materials as DynamicElement[];
    },
  ],

  messages: [
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      if (!task?.withMessages || !ctx.userModule?.messages?.length) return null;
      return ctx.userModule.messages as DynamicElement[];
    },
  ],

  inputs: [
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      if (!task?.withInputs || !ctx.inputs) return null;
      return JSON.stringify(ctx.inputs, null, 2);
    },
  ],
};

export const config: TaskTypeConfig = {
  module: thinkModule,
  builtinToolNames: ['__insert_tasks', '__time'],
};
