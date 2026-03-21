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
 * Builtin tools: none (external tools are still available if provided)
 */

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildPreviousResultsNote } from './index.js';

const outputModule: PromptModule<AgenticWorkflowContext> = {
  instructions: [
    '- Refer to the pre-computed results in "Response Preparation Note" to compose your response.',
    '- If tools are available, you may call them to gather additional information needed for the response.',
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
