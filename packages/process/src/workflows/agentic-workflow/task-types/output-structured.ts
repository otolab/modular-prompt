/**
 * Output Structured task type
 *
 * Generates structured output based on schema.
 *
 * Instruction side:
 * - objective, terms
 * - schema (from userModule)
 *
 * Data side:
 * - All task results (entire execution log)
 *
 * Tools: none
 */

import type { PromptModule, MaterialElement } from '@modular-prompt/core';
import type { AgenticTask, AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

/**
 * Build outputStructured task module
 */
function buildModule(
  task: AgenticTask,
  context: AgenticWorkflowContext,
  userModule: PromptModule<AgenticWorkflowContext>
): PromptModule<AgenticWorkflowContext> {
  const materials: MaterialElement[] = [];

  // Add all task results
  if (context.executionLog && context.executionLog.length > 0) {
    materials.push(...buildPreviousResultsMaterials(context.executionLog));
  }

  return {
    objective: userModule.objective,
    terms: userModule.terms,

    state: [
      `Phase: output`,
      `Current task: ${task.description}`,
      `Task type: ${task.taskType}`,
    ],

    materials: materials.length > 0 ? materials : undefined,

    schema: userModule.schema,
  };
}

export const config: TaskTypeConfig = {
  buildModule,
  builtinToolNames: [],
};
