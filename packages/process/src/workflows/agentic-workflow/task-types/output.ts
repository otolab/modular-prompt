/**
 * Output task type
 *
 * Uses the full userModule (passed via workflowBase) as the prompt.
 * This module only adds:
 * - An instruction to refer to the pre-computed task results in preparationNote
 * - The execution log as preparationNote
 *
 * The model sees the original user prompt with task results injected,
 * so it naturally produces the expected response.
 *
 * Builtin tools: none
 */

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsNote } from './index.js';

const outputModule: PromptModule<AgenticWorkflowContext> = {
  instructions: [
    '- Compose the final response using the pre-computed results in "Response Preparation Note".',
    '- Focus on presenting the results clearly. You may adapt, rephrase, or convert values as needed for the audience, but do not perform substantive new analysis.',
  ],

  preparationNote: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.executionLog?.length) return null;
      return buildPreviousResultsNote(ctx.executionLog);
    },
  ],
};

export const config: TaskTypeConfig = {
  module: outputModule,
  builtinToolNames: [],
  maxTokensTier: 'middle',
};
