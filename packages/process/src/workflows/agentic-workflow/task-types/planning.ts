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

import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { extractTextFromSection } from './index.js';

const planningModule: PromptModule<AgenticWorkflowContext> = {
  instructions: [
    {
      type: 'subsection' as const,
      title: 'What is a Task',
      items: [
        'A task is a single unit of work executed by an independent AI instance.',
        '- Each task receives only: the objective, its own description, and results from previous tasks.',
        '- A task cannot see the original detailed instructions or guidelines (those are only available to you in this planning phase).',
        '- A task produces a text result that subsequent tasks can reference.',
      ],
    },
    {
      type: 'subsection' as const,
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
      type: 'subsection' as const,
      title: 'How to Plan',
      items: [
        '1. **Assess complexity**: Consider the objective and available information. A simple objective may need only one task before output. A complex objective may need multiple steps.',
        '2. **Identify required actions**: What information needs to be gathered? What analysis is needed? What tools must be called?',
        '3. **Design task sequence**: Order tasks so each builds on previous results.',
        '4. **Register tasks**: Call `__task` for each task with a specific description and taskType.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Writing Task Descriptions',
      items: [
        'The executing AI only sees: the objective, the task description, and previous task results. It does NOT see the original instructions, guidelines, or planning context.',
        'Write descriptions that are specific and self-contained — include enough detail for the AI to execute independently.',
      ],
    },
  ],

  materials: [
    (ctx: AgenticWorkflowContext) => {
      const text = extractTextFromSection(ctx.userModule?.instructions);
      if (!text) return null;
      return {
        type: 'material' as const,
        id: 'user-instructions',
        title: 'Instructions to decompose',
        content: text,
      };
    },
    (ctx: AgenticWorkflowContext) => {
      const text = extractTextFromSection(ctx.userModule?.guidelines);
      if (!text) return null;
      return {
        type: 'material' as const,
        id: 'user-guidelines',
        title: 'Guidelines to follow',
        content: text,
      };
    },
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.materials?.length) return null;
      return ctx.materials;
    },
  ],

  inputs: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.inputs) return null;
      return JSON.stringify(ctx.inputs, null, 2);
    },
  ],

  cue: [
    'Register your execution plan by calling the __task tool for each step.',
  ],
};

export const config: TaskTypeConfig = {
  module: planningModule,
  builtinToolNames: ['__task'],
};
