/**
 * Think task type
 *
 * Performs analysis or thinking tasks.
 *
 * Instruction side:
 * - objective, terms
 * - methodology: task list display
 * - instructions: task.description
 *
 * Data side:
 * - Previous task results
 * - ctx.inputs (if withInputs=true)
 * - ctx.messages (if withMessages=true)
 * - ctx.materials (if withMaterials=true)
 *
 * Tools: __task, __time
 */

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

const thinkModule: PromptModule<AgenticWorkflowContext> = {
  instructions: [
    {
      type: 'subsection' as const,
      title: 'Task Instructions',
      items: [
        (ctx: AgenticWorkflowContext) => {
          const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
          return task?.description ?? '';
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
      if (!task?.withMaterials || !ctx.materials?.length) return null;
      return ctx.materials;
    },
  ],

  messages: [
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      if (!task?.withMessages || !ctx.messages?.length) return null;
      return ctx.messages;
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
  builtinToolNames: ['__task', '__time'],
};
