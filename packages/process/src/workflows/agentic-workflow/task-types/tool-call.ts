/**
 * Tool Call task type
 *
 * Executes external tool calls to gather information or perform actions.
 * Similar to think but focused on tool usage.
 *
 * Tools: __insert_tasks, __time
 */

import type { PromptModule, DynamicElement } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

const toolCallModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '',
    '- You will execute the Task described in "Task Instructions" below.',
  ],

  instructions: [
    '- You will call external tools as instructed to gather information or perform actions.',
    '- Report the tool results clearly for subsequent Tasks.',
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

  inputs: [
    (ctx: AgenticWorkflowContext) => {
      const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      if (!task?.withInputs || !ctx.inputs) return null;
      return JSON.stringify(ctx.inputs, null, 2);
    },
  ],
};

export const config: TaskTypeConfig = {
  module: toolCallModule,
  builtinToolNames: ['__insert_tasks', '__time'],
};
