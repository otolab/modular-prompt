/**
 * Planning task type
 *
 * Analyzes the user prompt and extracts complexity to design a task sequence.
 * The userModule is converted to a single formatted material ("Original Request")
 * using distribute() + formatCompletionPrompt().
 *
 * Data side:
 * - userModule compiled as "Original Request" material (includes inputs)
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
    '- You are the planner. Workflow design is your responsibility.',
    '- Decompose the original request and reconstruct it as a workflow.',
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
    '- A **Workflow** is a sequence of Tasks that begins with this planning Task and ends with an output Task.',
    '- Each Task is executed by a separate AI instance. It receives deliverables from all previously completed Tasks and produces its own deliverable.',
    '- Your job is to design this Workflow: decide what deliverables are needed and how each Task produces them.',
  ],
  instructions: [
    'Follow these 4 steps:',
    '',
    '1. **Analyze**',
    '  - Read "Original Request" to grasp what is being asked and what the final deliverable should be.',
    '  - Check "Available Tools" to understand what deliverables tools can produce.',
    '2. **Design**',
    '  - Design the sequence of Tasks and deliverables that leads from the input to the final deliverable. See "Task Type Guide" and "Planning Theory".',
    '3. **Refine**',
    '  - Adjust each Task\'s input so it can work correctly and efficiently. Exclude original data (withoutMessages/withoutInputs/withoutMaterials) when deliverables are sufficient. See "What Each Task Can See".',
    '4. **Register**',
    '  - Call `__register_tasks` to register the designed Tasks.',
    '  - If the work is simple enough (e.g. a single tool call), you may call the tool directly.',
  ],
  guidelines: [
    '- Focus on designing the flow of deliverables, not on solving the problem itself. Each Task executor will handle the specifics — never dictate how a Task should be solved.',
    '- Only register a Task when it produces a distinct deliverable that no other Task covers.',
    '- Write each Task instruction as a description of the deliverable to produce. A longer paragraph is fine, but step-by-step procedural instructions are unnecessary.',
    {
      type: 'subsection' as const,
      title: 'Task Type Guide',
      items: [
        '| Type | Nature | Use when | Deliverable |',
        '|------|--------|----------|-------------|',
        '| **extractContext** | Focus / Filter | Input is large, context resolution needed, summarization needed | Focused subset, summary, or structured extraction from the source |',
        '| **think** | Diverge / Create | Forward-looking analysis, creative work, expanding information | New insights, ideas, analysis, or generated content |',
        '| **verify** | Inspect / Critique | Quality review, finding improvements, assessing validity | Assessment with issues found, improvement suggestions, or approval |',
        '| **determine** | Converge / Decide | A decision is required, yes/no judgment, opinion synthesis | A clear decision or conclusion with supporting reasoning |',
        '| **act** | External action | Tool execution is the primary purpose | Results of tool calls from "Available Tools" |',
        '| **recall** | External retrieval | Search or external memory lookup needed | Retrieved facts or documents |',
        '| **output** | Final response | Always last | User-facing response composed from previous deliverables |',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Planning Theory',
      items: [
        '- Never repeat the same Task Type consecutively — if you have multiple think tasks in a row, merge them into one.',
        '- Use diverse Task Types to leverage their distinct natures (diverge, converge, inspect, act).',
        '- Match the number of Tasks to the problem complexity. Simple tasks need fewer Tasks.',
        '',
        '**Common Patterns:**',
        '- Simple Q&A, greeting → `output`',
        '- Summarize long materials → `extractContext → output`',
        '- Explain or analyze something → `think → output`',
        '- Search act from large input → `extractContext → act(search) → output`',
        '- Answer with judgment → `determine → output`',
        '- File comparison → `extractContext → think → verify → output`',
        '- Complex task → `think → verify → act → output`',
        '- Difficult coding → `extractContext → think → verify → think → determine → output`',
        '',
        '**Re-planning (`__replan`):**',
        '- Execution Tasks can call `__replan` when the current plan is insufficient.',
        '- Re-planning resets remaining tasks while preserving completed deliverables.',
        '- Design plans that allow early Tasks to surface issues, so re-planning can adjust before wasting effort.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'What Each Task Can See',
      items: [
        '- By default, each Task sees the Objective, Terms, deliverables from previous Tasks, AND the original user messages, inputs, and materials.',
        '- Exclusion options:',
        '  - **withoutMessages**: Exclude the original user messages.',
        '  - **withoutInputs**: Exclude the user-provided input data.',
        '  - **withoutMaterials**: Exclude the user-provided materials.',
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
        title: 'Original Request',
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
    '- If the messages in "Original Request" contain tool results, understand the user message → tool call → tool result sequence as planning context.',
  ],
};

export const config: TaskTypeConfig = {
  module: planningModule,
  builtinToolNames: ['__register_tasks', '__time'],
  maxTokensTier: 'high',
};
