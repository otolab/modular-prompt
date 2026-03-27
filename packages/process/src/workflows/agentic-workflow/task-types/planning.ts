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
    '- Design a Workflow by composing Tasks that satisfy these principles:',
    '  - **Solvability**: Each task must be completable by a single AI instance with available tools.',
    '  - **Completeness**: The full set of tasks must cover the entire user objective.',
    '  - **Non-redundancy**: No unnecessary or overlapping tasks.',
  ],
  terms: [
    '- **Workflow**: A chain of deliverables that achieves the Objective.',
    '- **Task**: A unit of work that produces a specific deliverable. Each Task is executed by a separate AI instance.',
    '- **Deliverable**: The concrete output a Task produces. It becomes input for subsequent Tasks.',
    '- **Task Type**: Defines the role and prompt structure of a Task.',
    '- **Tool**: A function available to Tasks for performing external actions or retrieving information. Used primarily in act and recall Tasks.',
  ],
  methodology: [
    '- Define Tasks in terms of what they produce (deliverables), not just what they do.',
    '- Each Task receives the deliverables of all previously completed Tasks.',
    '- Design the deliverable chain so that each Task has sufficient input to produce its output.',
    '- Tasks are executed sequentially by separate AI instances.',
  ],
  instructions: [
    {
      type: 'subsection' as const,
      title: 'Analyze',
      items: [
        '- Read "Prompt to analyze" and identify the final deliverable.',
        '- Check "Available Tools" to understand what deliverables tools can produce.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Design',
      items: [
        '- Work backward from the final deliverable: identify what intermediate deliverables are needed.',
        '- Assign a Task for each deliverable. Choose the Task Type by what it produces.',
        '- For each Task, clarify why it is necessary (reason) and which prior deliverables it depends on (dep).',
        '- If a deliverable requires an external action via tools, use an act Task.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Register',
      items: [
        '- Call `__insert_tasks` to register the designed Tasks.',
        '- If the work is simple enough (e.g. a single tool call), you may call the tool directly.',
      ],
    },
  ],
  guidelines: [
    '- Only register a Task when it produces a distinct deliverable that no other Task covers.',
    '- Write each Task instruction as a description of the deliverable to produce. A longer paragraph is fine, but step-by-step procedural instructions are unnecessary.',
    {
      type: 'subsection' as const,
      title: 'Task Type Guide',
      items: [
        '- **think**: Produces analysis, reasoning, or processed results.',
        '- **act**: Performs an external action using tools and reports its outcome.',
        '- **extractContext**: Produces structured extraction from inputs, messages, or materials.',
        '- **recall**: Produces retrieved knowledge from search tools or training data.',
        '- **verify**: Produces a validation report on previous deliverables.',
        '- **determine**: Produces a definitive decision with supporting reasoning.',
        '- **output**: Produces the final user-facing response from previous deliverables. Must be the last Task.',
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
  builtinToolNames: ['__insert_tasks', '__time'],
  maxTokensTier: 'high',
};
