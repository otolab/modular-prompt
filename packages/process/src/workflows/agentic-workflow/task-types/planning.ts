/**
 * Planning task type
 *
 * Analyzes the user prompt and extracts complexity to design a task sequence.
 * The userModule is converted to a single formatted material ("Prompt to analyze")
 * using distribute() + formatCompletionPrompt().
 *
 * Data side:
 * - userModule compiled as "Prompt to analyze" material (includes inputs)
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
    '- You are the planner. Analysis and task design are your responsibility.',
    '- Analyze the given prompt to understand what needs to be accomplished.',
    '- Design a Workflow by composing the minimum sequence of Tasks needed.',
  ],
  terms: [
    '- **Workflow**: The entire process that achieves the Objective by executing a sequence of Tasks.',
    '- **Task**: A unit of work in the Workflow. Each Task is executed by a separate AI instance.',
    '- **Task Type**: Defines the role of a Task. The prompt is pre-configured for each type.',
    '- **Tool**: A function that a Task can call to perform actions or retrieve information. See "Available Tools" in Guidelines.',
    '- **State**: Persistent information shared across Tasks. Updated via `__update_state` and visible to all subsequent Tasks.',
  ],
  methodology: [
    '- Tasks are executed sequentially by separate AI instances.',
    '- Each Task receives results from all previously completed Tasks.',
    '- Tool call results from one Task are passed to the next Task.',
  ],
  instructions: [
    '- Read "Prompt to analyze" and determine what the final output should be.',
    '- Check "Available Tools" to understand what tools can be used in the Workflow.',
    '- Determine the minimum set of Tasks needed — a simple prompt may need only one.',
    '- If tools are needed, schedule toolCall Tasks for them.',
    '- Call `__insert_tasks` to register Tasks. If the work is simple enough (e.g. a single tool call), you may call the tool directly instead of scheduling a Task.',
  ],
  guidelines: [
    '- Only register Tasks for work that requires a separate AI instance to execute.',
    '- Write each Task instruction as a descriptive action statement — what the Task does and what outcome is expected. A longer paragraph is fine, but step-by-step procedural instructions are unnecessary.',
    {
      type: 'subsection' as const,
      title: 'Task Type Guide',
      items: [
        '- **think**: General reasoning, analysis, or processing.',
        '- **toolCall**: Call tools and report results.',
        '- **extractContext**: Extract information from inputs, messages, or materials.',
        '- **recall**: Retrieve information via search tools or training knowledge.',
        '- **verify**: Validate results from previous Tasks.',
        '- **determine**: Make a definitive decision or judgment.',
        '- **output**: Format and present the final response from previous Task results. No new work is performed. Must be the last Task.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Available Tools',
      items: [
        (ctx: AgenticWorkflowContext) => {
          if (!ctx.availableTools?.length) return 'No tools available.';
          return ctx.availableTools.map(t =>
            `- **${t.name}**: ${t.description || '(no description)'}`
          ).join('\n');
        },
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
  builtinToolNames: ['__insert_tasks', '__update_state', '__time'],
  maxTokensTier: 'high',
};
