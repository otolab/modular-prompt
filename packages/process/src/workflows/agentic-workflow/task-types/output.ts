/**
 * Output task type
 *
 * Uses the full userModule (passed via workflowBase) as the prompt.
 * This module only adds:
 * - An instruction to compose the final response from previous deliverables
 *
 * Previous task deliverables are provided via the state section (from taskCommon).
 * The model sees the original user prompt with deliverables injected,
 * so it naturally produces the expected response.
 *
 * Builtin tools: none
 */

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';

const outputModule: PromptModule<AgenticWorkflowContext> = {
  instructions: [
    '- Compose the final response using the deliverables from previous Tasks (shown in "Current State").',
    '- Focus on presenting the results clearly. You may adapt, rephrase, or convert values as needed for the audience, but do not perform substantive new analysis.',
  ],
};

export const config: TaskTypeConfig = {
  module: outputModule,
  builtinToolNames: [],
  maxTokensTier: 'middle',
};
