/**
 * Output task type (unified)
 *
 * Generates final output. Automatically switches behavior based on schema presence:
 * - With schema (userModule.schema): structured JSON output
 * - Without schema: text message output with cue
 *
 * Instruction side:
 * - objective (from userModule via workflowBase, + task-specific framing)
 * - terms (from taskCommon + userModule)
 * - cue (from userModule via workflowBase, when no schema)
 * - schema (from userModule via workflowBase, when schema exists)
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

const outputModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '',
    '- You will generate the final output based on all previous Task results.',
  ],

  instructions: [
    (ctx: AgenticWorkflowContext) => {
      if (ctx.userModule?.schema?.length) {
        return '- You will synthesize the results from all previous Tasks into structured (JSON) output.\n- You should conform to the Output Schema specified in the "Output" section.';
      }
      return '- You will synthesize the results from all previous Tasks into a coherent final output.\n- You should follow the output format specified in the "Output" section if provided.';
    },
  ],

  materials: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.executionLog?.length) return null;
      return buildPreviousResultsMaterials(ctx.executionLog);
    },
  ],
};

export const config: TaskTypeConfig = {
  module: outputModule,
  builtinToolNames: [],
};
