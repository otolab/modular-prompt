/**
 * Output Message task type
 *
 * Generates text output message.
 *
 * Instruction side:
 * - objective, terms
 * - cue (from userModule)
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
