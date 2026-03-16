/**
 * Extract Context task type
 *
 * Aggregates context from multiple sources.
 *
 * Instruction side:
 * - objective, terms
 * - methodology: task list display
 * - instructions: task.description
 *
 * Data side:
 * - Previous task results
 * - ctx.inputs (if withInputs=true, default: true)
 * - ctx.messages (if withMessages=true, default: true)
 * - ctx.materials (if withMaterials=true, default: true)
 *
 * Tools: __task, __time
 */

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

const extractContextModule: PromptModule<AgenticWorkflowContext> = {
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
      const withMaterials = task?.withMaterials ?? true;  // default true
      if (!withMaterials || !ctx.materials?.length) return null;
      return ctx.materials;
    },
  ],

  messages: [
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      const withMessages = task?.withMessages ?? true;  // default true
      if (!withMessages || !ctx.messages?.length) return null;
      return ctx.messages;
    },
  ],

  inputs: [
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      const withInputs = task?.withInputs ?? true;  // default true
      if (!withInputs || !ctx.inputs) return null;
      return JSON.stringify(ctx.inputs, null, 2);
    },
  ],
};

export const config: TaskTypeConfig = {
  module: extractContextModule,
  builtinToolNames: ['__task', '__time'],
};
