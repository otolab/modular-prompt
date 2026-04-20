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
 * - cue: user message instructing to call task type tools
 *
 * Tools: think, verify, act, extractContext, recall, determine, output
 */

import type { PromptModule } from '@modular-prompt/core';
import { distribute } from '@modular-prompt/core';
import { formatCompletionPrompt } from '@modular-prompt/driver';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { buildTaskListWithResults } from './index.js';
import { TASK_TYPE_TOOL_NAMES } from '../process/builtin-tools.js';

const planningModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '- You are the planner. Your responsibility is to analyze the request and design a Workflow.',
    '- Your output consists of two parts: a user-readable analysis of the request, and task registrations via tool calls.',
    '- Analyze the original request data to understand what is being asked, then decompose it into a Workflow.',
    '- The Workflow must satisfy these principles:',
    '  - **Solvability**: Each task must be completable by a single AI instance with available tools.',
    '  - **Completeness**: The full set of tasks must cover the entire user objective.',
    '  - **Non-redundancy**: No unnecessary or overlapping tasks.',
  ],
  terms: [
    '- **Workflow**: A chain of deliverables that achieves the Objective.',
    '- **Original Data**: The user-provided messages, inputs, and materials.',
    '- **Deliverable**: The concrete output a Task produces. It becomes input for subsequent Tasks.',
    '- **Task**: A unit of work that produces a specific deliverable. Each Task is executed by a separate AI instance.',
    '- **Task Type**: Defines the role and prompt structure of a Task.',
    '- **Tool**: A function available to Tasks for performing external actions or retrieving information. Used primarily in act and recall Tasks.',
  ],
  methodology: [
    '- A **Workflow** is a sequence of Tasks that begins with this planning Task and ends with an output Task.',
    '- Each Task is executed by a separate AI instance. It receives deliverables from all previously completed Tasks and produces its own deliverable.',
    '- Your job is to design this Workflow: decide what deliverables are needed and how each Task produces them.',
    '- This planning Task produces two kinds of output:',
    '  - **Text output**: Your analysis of the request. This becomes a deliverable visible to all subsequent Tasks.',
    '  - **Tool calls**: Call the task type tool (e.g. `think()`, `output()`) to register each Task into the Workflow.',
  ],
  instructions: [
    'Follow these 3 steps:',
    '',
    '1. **Analyze** — Output your analysis in a user-readable format.',
    '  - Read "Original Request" to grasp what is being asked and what the final deliverable should be.',
    '  - Check "Available Tools" to understand what deliverables tools can produce.',
    '  - Identify the key complexity: what makes this request non-trivial, what knowledge or steps are required.',
    '2. **Design & Refine**',
    '  - Design the sequence of Tasks and deliverables that leads from the input to the final deliverable. See "Task Type Guide" and "Planning Theory".',
    '  - Adjust each Task\'s input so it can work correctly and efficiently. Exclude Original Data when deliverables are sufficient. See "What Each Task Can See".',
    '3. **Register** — Call the task type tool once per Task (e.g. `think({...})`, `output({...})`).',
    '  - Each Task\'s `reason` should explain why it is needed. Each Task\'s `instruction` should describe the deliverable to produce.',
  ],
  guidelines: [
    '- Focus on designing the flow of deliverables, not on solving the problem itself. Each Task executor will handle the specifics — never dictate how a Task should be solved.',
    '- Only register a Task when it produces a distinct deliverable that no other Task covers.',
    '- Write each Task instruction as a description of the deliverable to produce. A longer paragraph is fine, but step-by-step procedural instructions are unnecessary.',
    {
      type: 'subsection' as const,
      title: 'Planning Theory',
      items: [
        'A good plan satisfies the three principles:',
        '',
        '- **Solvability**',
        '  — Each Task can be completed from its instruction, deliverables from previous Tasks, and Original Data.',
        '  - The instruction must clearly describe the deliverable to produce.',
        '  - The Task must have sufficient input (deliverables and/or Original Data) to produce the deliverable.',
        '- **Completeness**',
        '  — The full chain of deliverables covers the entire objective with no gaps.',
        '- **Non-redundancy**:',
        '  — No unnecessary Tasks or unnecessary input.',
        '  - Only create a Task when it produces a distinct deliverable. Merge similar work into one Task.',
        '  - Exclude Original Data from a Task when deliverables are sufficient (see Refine step).',
        '  - Match the number of Tasks to the problem complexity.',
        '',
        '**Common Patterns**:',
        '  - Simple Q&A, greeting → `output`',
        '  - Summarize long materials → `extractContext → output`',
        '  - Explain or analyze something → `think → output`',
        '  - Search act from large input → `extractContext → act(search) → output`',
        '  - Answer with judgment → `determine → output`',
        '  - File comparison → `extractContext → think → verify → output`',
        '  - Complex task → `think → verify → act → output`',
        '  - Difficult coding → `extractContext → think → verify → think → determine → output`',
      ],
    },
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
      title: 'What Each Task Can See',
      items: [
        '- Each Task always sees: the original Terms, and deliverables from all previous Tasks.',
        '- Each Task also sees Original Data (messages, inputs, materials) by default. Use exclusion options to remove them:',
        '  - **withoutMessages**: Exclude messages. Use when the Task instruction captures the intent sufficiently.',
        '  - **withoutInputs**: Exclude inputs. Use when `extractContext` has already extracted what is needed, or when inputs are not relevant to the Task.',
        '  - **withoutMaterials**: Exclude materials. Use when the Task requires focused reasoning on deliverables alone.',
      ],
    },
  ],

  materials: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.userModule) return null;
      const compiled = distribute(ctx.userModule);
      const rawText = formatCompletionPrompt(compiled, {
        sectionDescriptions: {},
      });
      if (!rawText.trim()) return null;
      const text = rawText.split('\n').map(line => `> ${line}`).join('\n');
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
      content: 'Output your analysis in a user-readable format, then register tasks.',
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
  builtinToolNames: [...TASK_TYPE_TOOL_NAMES, '__time'],
  maxTokensTier: 'high',
};
