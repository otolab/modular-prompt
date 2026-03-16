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

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsMaterials } from './index.js';

const outputStructuredModule: PromptModule<AgenticWorkflowContext> = {
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
