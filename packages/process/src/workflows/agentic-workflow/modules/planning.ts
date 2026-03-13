import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';

/**
 * Planning phase module for agent workflow
 * Phase-specific definitions for generating execution plan
 *
 * Should be merged with agentic and user's module:
 *   merge(agentic, planning, userModule)
 */
export const planning: PromptModule<AgenticWorkflowContext> = {
  methodology: [
    '- **Current Phase: Planning**',
    '  - Generate an execution plan by breaking down the Objective and Instructions into 3-5 executable tasks.',
    '  - Register each task using the `__task` tool provided.'
  ],

  instructions: [
    {
      type: 'subsection',
      title: 'Planning Requirements',
      items: [
        '- Break down the **Objective and Instructions shown above** into 3-5 concrete executable tasks',
        '- Register each task using the `__task` tool',
        '- Each task must have: id, description, guidelines (2-4 items), constraints (1-3 items)',
        '  - **guidelines**: Specific actions or principles to follow in this task',
        '  - **constraints**: Specific limitations or prohibitions for this task',
        '- The tasks should accomplish the Instructions in a logical sequence',
        '- Ensure logical flow between tasks'
      ]
    }
  ],

  state: [
    'Phase: planning'
  ],

  cue: [
    'Register your execution plan by calling the __task tool for each step.'
  ]
};
