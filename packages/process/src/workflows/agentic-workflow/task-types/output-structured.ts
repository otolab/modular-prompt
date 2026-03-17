/**
 * Output Structured task type
 *
 * Generates structured output based on schema.
 *
 * Instruction side:
 * - objective (from userModule via workflowBase, + task-specific framing)
 * - terms (from taskCommon + userModule)
 * - schema (from userModule via workflowBase)
 *
 * Data side:
 * - All task results (entire execution log)
 *
 * Tools: none
 */

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

const outputStructuredModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '',
    '- You will generate the final structured output based on all previous Task results.',
  ],

  instructions: [
    '- You will synthesize the results from all previous Tasks into structured (JSON) output.',
    '- You should conform to the Output Schema specified in the "Output" section.',
  ],

  materials: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.executionLog?.length) return null;
      return buildPreviousResultsMaterials(ctx.executionLog);
    },
  ],
};

export const config: TaskTypeConfig = {
  module: outputStructuredModule,
  builtinToolNames: [],
};
