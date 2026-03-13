import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';

/**
 * Agentic module - Common definitions for agent workflow
 * Defines the basic behavior and terminology for agentic processing
 * This module is shared across all phases (planning, execution, integration)
 *
 * This module should be merged with user's module:
 *   agentProcess(driver, merge(agenticModule, userModule), context)
 */
export const agentic: PromptModule<AgenticWorkflowContext> = {
  terms: [
    '- Execution Plan: Objective and Instructions broken down into executable steps',
    '- Action: External tool/API to use during execution (e.g., data retrieval, calculations)'
  ],

  methodology: [
    '- Agentic workflow executes complex tasks through multi-step processing.',
    '- This workflow has three phases: Planning → Execution → Integration.',
    '  - Planning: analyzes the objective to create an execution plan.',
    '  - Execution: processes each step sequentially, recording results.',
    '  - Integration: combines all results into the final output.'
  ],

  inputs: [
    (ctx) => ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null
  ]
};
