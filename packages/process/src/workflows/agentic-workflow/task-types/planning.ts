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
 * - cue: user message instructing to call __register_tasks tool
 *
 * Tools: __register_tasks
 */

import type { PromptModule } from '@modular-prompt/core';
import { distribute } from '@modular-prompt/core';
import { formatCompletionPrompt } from '@modular-prompt/driver';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildTaskListWithResults } from './index.js';

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
        '- For each Task, determine what context it needs to do its work. If it needs to read the original user request, enable withMessages. See "What Each Task Can See" for details.',
        '- If a deliverable requires an external action via tools, use an act Task.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Register',
      items: [
        '- Call `__register_tasks` to register the designed Tasks.',
        '- If the work is simple enough (e.g. a single tool call), you may call the tool directly.',
      ],
    },
  ],
  guidelines: [
    '- Focus on designing the flow of deliverables, not on solving the problem itself. Each Task executor will handle the specifics — never dictate how a Task should be solved.',
    '- Only register a Task when it produces a distinct deliverable that no other Task covers.',
    '- Write each Task instruction as a description of the deliverable to produce. A longer paragraph is fine, but step-by-step procedural instructions are unnecessary.',
    {
      type: 'subsection' as const,
      title: 'Task Type Guide',
      items: [
        '- **think**: Produces analysis, reasoning, or processed results.',
        '- **act**: Performs an external action using tools listed in "Available Tools" and reports its outcome. Only tools shown there can be used.',
        '- **extractContext**: Produces structured extraction from inputs, messages, or materials.',
        '- **recall**: Produces retrieved knowledge from search tools or training data.',
        '- **verify**: Produces a validation report on previous deliverables.',
        '- **determine**: Produces a definitive decision with supporting reasoning.',
        '- **output**: Produces the final user-facing response from previous deliverables. Must be the last Task.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'What Each Task Can See',
      items: [
        '- By default, each Task sees ONLY the Objective, Terms, and deliverables from previous Tasks. The original user messages, inputs, and materials are NOT visible unless explicitly enabled.',
        '- When the source data is large, use an **extractContext** Task first to extract relevant information as a deliverable, rather than passing the full data to every Task.',
        '- Task options to enable visibility:',
        '  - **withMessages**: Pass the original user messages (the conversation/request) to the Task.',
        '  - **withInputs**: Pass the user-provided input data to the Task.',
        '  - **withMaterials**: Pass the user-provided materials to the Task.',
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
      content: 'Analyze the prompt and register tasks by calling `__register_tasks`.',
    },
  ],
};

/**
 * Additional module for re-planning.
 *
 * Merged with planningModule when existing deliverables are present
 * (either from executionLog after __replan, or from trailing tool results).
 * Provides the planner with visibility into completed work and current task list.
 */
export const replanningModule: PromptModule<AgenticWorkflowContext> = {
  methodology: [
    '- This is a re-planning phase. Previous tasks and their results are shown below.',
    '- Factor existing deliverables into the new plan without re-requesting them.',
    {
      type: 'subsection' as const,
      title: 'Previous Execution',
      items: [
        (ctx: AgenticWorkflowContext) => buildTaskListWithResults(ctx),
      ],
    },
  ],
  instructions: [
    '- Review the completed deliverables and design a new set of tasks to achieve the remaining objective.',
    '- If the messages in "Prompt to analyze" contain tool results, understand the user message → tool call → tool result sequence as planning context.',
  ],
};

export const config: TaskTypeConfig = {
  module: planningModule,
  builtinToolNames: ['__register_tasks', '__time'],
  maxTokensTier: 'high',
};
