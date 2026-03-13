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

import type { PromptModule, MaterialElement, MessageElement } from '@modular-prompt/core';
import type { AgenticTask, AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildTaskListDisplay, buildPreviousResultsMaterials } from './index.js';

/**
 * Build extractContext task module
 */
function buildModule(
  task: AgenticTask,
  context: AgenticWorkflowContext,
  userModule: PromptModule<AgenticWorkflowContext>
): PromptModule<AgenticWorkflowContext> {
  const materials: MaterialElement[] = [];

  // Add previous task results
  if (context.executionLog && context.executionLog.length > 0) {
    materials.push(...buildPreviousResultsMaterials(context.executionLog));
  }

  // Add context materials if withMaterials (default: true)
  const withMaterials = task.withMaterials ?? true;
  if (withMaterials && context.materials) {
    materials.push(...context.materials);
  }

  // Prepare messages if withMessages (default: true)
  const withMessages = task.withMessages ?? true;
  const messages: MessageElement[] | undefined = withMessages && context.messages
    ? [...context.messages]
    : undefined;

  // Prepare inputs if withInputs (default: true)
  const withInputs = task.withInputs ?? true;

  return {
    objective: userModule.objective,
    terms: userModule.terms,

    methodology: [
      (ctx) => {
        const taskListDisplay = buildTaskListDisplay(ctx);
        return `**Current Phase: Execution (Extract Context)**\n\nTask List:\n${taskListDisplay}`;
      },
    ],

    instructions: [
      {
        type: 'subsection',
        title: 'Task Instructions',
        items: [task.description],
      },
    ],

    state: [
      `Phase: execution`,
      `Current task: ${task.description}`,
      `Task type: ${task.taskType}`,
    ],

    materials: materials.length > 0 ? materials : undefined,

    messages,

    inputs: withInputs && context.inputs ? [
      {
        type: 'subsection',
        title: 'Input Data',
        items: [JSON.stringify(context.inputs, null, 2)],
      },
    ] : undefined,
  };
}

export const config: TaskTypeConfig = {
  buildModule,
  builtinToolNames: ['__task', '__time'],
};
