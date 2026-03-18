/**
 * Planning task type
 *
 * Analyzes the user prompt and extracts complexity to design a task sequence.
 * The userModule is converted to a single formatted material ("Prompt to analyze")
 * using distribute() + formatCompletionPrompt().
 *
 * Data side:
 * - userModule compiled as "Prompt to analyze" material
 * - ctx.inputs
 *
 * Output side:
 * - cue: user message instructing to call __insert_tasks tool
 *
 * Tools: __insert_tasks
 */

import type { PromptModule } from '@modular-prompt/core';
import { distribute } from '@modular-prompt/core';
import { formatCompletionPrompt } from '@modular-prompt/driver';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';

const planningModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '- Analyze the given prompt and extract complexity to design a task sequence.',
  ],
  instructions: [
    '- Analyze the prompt shown in "Prompt to analyze" and design the Tasks needed for execution.',
    '- Call `__insert_tasks` once with a `tasks` array to register all Tasks.',
    '- Each Task instruction should be concise: describe only what to focus on and what to do.',
    '- Each Task receives all previous task results, so earlier results are available to later Tasks.',
    '- Tools can be called from each Task, but tool results are received by the next Task.',
    {
      type: 'subsection' as const,
      title: 'Analysis Approach',
      items: [
        '1. **Inputs and outputs**: Understand what the final goal requires and what is available.',
        '2. **Identify complexity**: Determine which parts of the prompt are complex and need decomposition. A simple prompt may need only one Task.',
        '3. **Dependencies**: Identify what information is needed first and the correct processing order.',
        '4. **Tool usage**: Identify where tool calls are required.',
      ],
    },
  ],

  materials: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.userModule) return null;
      const compiled = distribute(ctx.userModule);
      const text = formatCompletionPrompt(compiled, {
        sectionDescriptions: {},
      });
      if (!text.trim()) return null;
      return {
        type: 'material' as const,
        id: 'user-prompt',
        title: 'Prompt to analyze',
        content: text,
      };
    },
  ],

  inputs: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.inputs) return null;
      return JSON.stringify(ctx.inputs, null, 2);
    },
  ],

  cue: [
    {
      type: 'message' as const,
      role: 'user' as const,
      content: 'Analyze the prompt and register tasks by calling `__insert_tasks`.',
    },
  ],
};

export const config: TaskTypeConfig = {
  module: planningModule,
  builtinToolNames: ['__insert_tasks'],
};
