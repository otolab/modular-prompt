/**
 * Output Message task type
 *
 * Generates text output message.
 *
 * Instruction side:
 * - objective (from userModule via workflowBase, + task-specific framing)
 * - terms (from taskCommon + userModule)
 * - cue (from userModule via workflowBase)
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

const outputMessageModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '',
    '- You will generate the final output based on all previous Task results.',
  ],

  instructions: [
    '- You will synthesize the results from all previous Tasks into a coherent final output.',
    '- You should follow the output format specified in the "Output" section if provided.',
  ],

  materials: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.executionLog?.length) return null;
      return buildPreviousResultsMaterials(ctx.executionLog);
    },
  ],
};

export const config: TaskTypeConfig = {
  module: outputMessageModule,
  builtinToolNames: [],
};
