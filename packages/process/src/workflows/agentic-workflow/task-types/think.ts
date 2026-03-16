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

import type { PromptModule, MaterialElement, MessageElement } from '@modular-prompt/core';
import type { AgenticTask, AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { METHODOLOGY_INTRO, buildTaskListDisplay, buildPreviousResultsMaterials } from './index.js';

/**
 * Build think task module
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

  // Add context materials if withMaterials=true (default: false)
  if (task.withMaterials && context.materials) {
    materials.push(...context.materials);
  }

  // Prepare messages if withMessages=true (default: false)
  const messages: MessageElement[] | undefined = task.withMessages && context.messages
    ? [...context.messages]
    : undefined;

  return {
    objective: userModule.objective,
    terms: userModule.terms,

    methodology: [
      METHODOLOGY_INTRO,
      {
        type: 'subsection' as const,
        title: 'Current Phase',
        items: ['Execution — Carry out the assigned task and produce a result.'],
      },
      {
        type: 'subsection' as const,
        title: 'Task List',
        items: [(ctx: AgenticWorkflowContext) => buildTaskListDisplay(ctx)],
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

    inputs: task.withInputs && context.inputs ? [
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
