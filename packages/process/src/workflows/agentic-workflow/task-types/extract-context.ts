/**
 * Extract Context task type
 *
 * Aggregates context from multiple sources.
 *
 * Instruction side:
 * - objective (from userModule via workflowBase, + task-specific framing)
 * - terms (from taskCommon + userModule)
 * - methodology: current task, task list
 * - instructions: task.instruction
 *
 * Data side:
 * - Previous task results
 * - ctx.inputs (if withInputs=true, default: true)
 * - userModule.messages (if withMessages=true, default: true)
 * - userModule.materials (if withMaterials=true, default: true)
 *
 * Tools: __insert_tasks, __time
 */

import type { PromptModule, DynamicElement } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

const extractContextModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '',
    '- You will extract relevant information as described in "Task Instructions" below.',
  ],

  instructions: [
    '- You will extract and organize relevant information from the provided inputs, messages, and materials.',
    '- You should focus on what subsequent Tasks need to accomplish our Objective.',
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
      const withMaterials = task?.withMaterials ?? true;  // default true
      if (!withMaterials || !ctx.userModule?.materials?.length) return null;
      return ctx.userModule.materials as DynamicElement[];
    },
  ],

  messages: [
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      const withMessages = task?.withMessages ?? true;  // default true
      if (!withMessages || !ctx.userModule?.messages?.length) return null;
      return ctx.userModule.messages as DynamicElement[];
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
  builtinToolNames: ['__insert_tasks', '__time'],
};
