/**
 * Planning task type
 *
 * Generates execution plan by breaking down the objective into executable tasks.
 *
 * Instruction side (merged):
 * - objective (from userModule)
 * - terms (from userModule)
 * - methodology: task list display, planning-specific instructions
 * - instructions: "Register tasks using __task tool"
 *
 * Data side:
 * - userModule.instructions as material
 * - userModule.guidelines as material
 * - ctx.materials
 * - ctx.inputs
 *
 * Tools: __task
 */

import type { PromptModule, MaterialElement, SectionContent } from '@modular-prompt/core';
import type { AgenticTask, AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { METHODOLOGY_INTRO, buildTaskListDisplay } from './index.js';

/**
 * Extract text content from SectionContent
 */
function extractTextFromSection(section: SectionContent<any> | undefined): string {
  if (!section) return '';

  const items = Array.isArray(section) ? section : [section];
  const textParts: string[] = [];

  for (const item of items) {
    if (typeof item === 'string') {
      textParts.push(item);
    }
    // DynamicContent and SubSectionElement are not evaluated here
    // Only static strings are included
  }

  return textParts.join('\n');
}

/**
 * Build planning task module
 */
function buildModule(
  task: AgenticTask,
  context: AgenticWorkflowContext,
  userModule: PromptModule<AgenticWorkflowContext>
): PromptModule<AgenticWorkflowContext> {
  const materials: MaterialElement[] = [];

  // Add user instructions as material
  const instructionsText = extractTextFromSection(userModule.instructions);
  if (instructionsText) {
    materials.push({
      type: 'material',
      id: 'user-instructions',
      title: 'Instructions to decompose',
      content: instructionsText,
    });
  }

  // Add user guidelines as material
  const guidelinesText = extractTextFromSection(userModule.guidelines);
  if (guidelinesText) {
    materials.push({
      type: 'material',
      id: 'user-guidelines',
      title: 'Guidelines to follow',
      content: guidelinesText,
    });
  }

  // Add context materials
  if (context.materials) {
    materials.push(...context.materials);
  }

  return {
    objective: userModule.objective,
    terms: userModule.terms,

    methodology: [
      METHODOLOGY_INTRO,
      {
        type: 'subsection' as const,
        title: 'Current Phase',
        items: ['Planning — Analyze the objective and design an execution plan. Register each task using the `__task` tool.'],
      },
      {
        type: 'subsection' as const,
        title: 'Task List',
        items: [(ctx: AgenticWorkflowContext) => buildTaskListDisplay(ctx)],
      },
    ],

    instructions: [
      {
        type: 'subsection',
        title: 'What is a Task',
        items: [
          'A task is a single unit of work executed by an independent AI instance.',
          '- Each task receives only: the objective, its own description, and results from previous tasks.',
          '- A task cannot see the original detailed instructions or guidelines (those are only available to you in this planning phase).',
          '- A task produces a text result that subsequent tasks can reference.',
        ],
      },
      {
        type: 'subsection',
        title: 'Available Task Types',
        items: [
          '- **think**: General-purpose reasoning and analysis. Can call external tools.',
          '- **extractContext**: Extract information from inputs and materials. Can call external tools.',
          '- **outputMessage**: Generate the final text output. Cannot call tools — only synthesizes from previous task results.',
          '- **outputStructured**: Generate structured (JSON) output. Cannot call tools.',
          '',
          'An output task is always the final task. Since it cannot call tools, any tool-dependent work must be completed in earlier tasks.',
        ],
      },
      {
        type: 'subsection',
        title: 'How to Plan',
        items: [
          '1. **Assess complexity**: Consider the objective and available information. A simple objective may need only one task before output. A complex objective may need multiple steps.',
          '2. **Identify required actions**: What information needs to be gathered? What analysis is needed? What tools must be called?',
          '3. **Design task sequence**: Order tasks so each builds on previous results.',
          '4. **Register tasks**: Call `__task` for each task with a specific description and taskType.',
        ],
      },
      {
        type: 'subsection',
        title: 'Writing Task Descriptions',
        items: [
          'The executing AI only sees: the objective, the task description, and previous task results. It does NOT see the original instructions, guidelines, or planning context.',
          'Write descriptions that are specific and self-contained — include enough detail for the AI to execute independently.',
        ],
      },
    ],

    state: [
      `Phase: planning`,
      `Current task: ${task.description}`,
    ],

    materials,

    inputs: context.inputs ? [
      {
        type: 'subsection',
        title: 'Input Data',
        items: [JSON.stringify(context.inputs, null, 2)],
      },
    ] : undefined,

    cue: [
      'Register your execution plan by calling the __task tool for each step.',
    ],
  };
}

export const config: TaskTypeConfig = {
  buildModule,
  builtinToolNames: ['__task'],
};
