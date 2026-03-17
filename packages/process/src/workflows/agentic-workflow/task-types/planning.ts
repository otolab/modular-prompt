/**
 * Planning task type
 *
 * Generates execution plan by breaking down the objective into executable tasks.
 *
 * Instruction side (merged):
 * - objective (from userModule via workflowBase, + planning-specific framing)
 * - terms (from taskCommon + userModule)
 * - methodology: current task display, task list
 * - instructions: how to plan, task types, task descriptions
 *
 * Data side:
 * - userModule.instructions as material
 * - userModule.guidelines as material
 * - userModule.messages as material
 * - userModule.materials
 * - ctx.inputs
 *
 * Output side:
 * - cue: user message instructing to call __insert_tasks tool
 *
 * Tools: __insert_tasks
 */

import type { PromptModule, DynamicElement, StandardMessageElement } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { TaskTypeConfig } from './index.js';
import { extractTextFromSection } from './index.js';

const planningModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '',
    '- You will edit our Plan by registering Tasks to accomplish the above Objective.',
  ],
  instructions: [
    '- You will formulate a Plan and register your Tasks by calling the `__insert_tasks` tool with a `tasks` array containing all Tasks.',
    '- You should review the "Data" section for materials and inputs that inform your Plan.',
    '- You should decompose the materials "Instructions to decompose" and "Guidelines to follow" into concrete Task instructions.',
    {
      type: 'subsection' as const,
      title: 'How to Plan',
      items: [
        '1. **Assess complexity**: You consider the Objective and available information. A simple Objective may need only one Task before output. A complex one may need multiple steps.',
        '2. **Identify required actions**: You determine what information needs to be gathered, what analysis is needed, and what tools must be called.',
        '3. **Design Task sequence**: You order Tasks so each builds on previous results.',
        '4. **Register Tasks**: You call `__insert_tasks` once with a `tasks` array. Each element specifies an instruction and taskType.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Writing Task Descriptions',
      items: [
        'Each Task is executed by a separate AI instance that only sees: the Objective, its own Task description, and results from previous Tasks. It does NOT see our original instructions, guidelines, or planning context.',
        'You should write descriptions that are specific and self-contained — include enough detail for the executing AI to work independently.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'What is a Task',
      items: [
        'A Task is a unit of work executed by one of our AI instances.',
        '- Each Task receives only: the Objective, its own description, and results from previous Tasks.',
        '- A Task cannot see the original detailed instructions or guidelines (those are only available to you in this planning phase).',
        '- A Task produces a text result that subsequent Tasks can reference.',
      ],
    },
    {
      type: 'subsection' as const,
      title: 'Available Task Types',
      items: [
        '- **think**: General-purpose reasoning and analysis. Can call external tools.',
        '- **extractContext**: Extract information from inputs and materials. Can call external tools.',
        '- **outputMessage**: Generate the final text output. Cannot call tools — only synthesizes from previous Task results.',
        '- **outputStructured**: Generate structured (JSON) output. Cannot call tools.',
        '',
        'An output Task is always the final Task. Since it cannot call tools, any tool-dependent work must be completed in earlier Tasks.',
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
      if (!ctx.userModule?.messages?.length) return null;
      const msgs = ctx.userModule.messages.filter(
        (item): item is StandardMessageElement =>
          typeof item === 'object' && 'type' in item && item.type === 'message' && 'content' in item
      );
      if (msgs.length === 0) return null;
      const text = msgs
        .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n');
      return {
        type: 'material' as const,
        id: 'user-messages',
        title: 'User messages',
        content: text,
      };
    },
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.userModule?.materials?.length) return null;
      return ctx.userModule.materials as DynamicElement[];
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
      content: 'Please register your execution plan by calling `__insert_tasks` with a `tasks` array containing all the Tasks you want to add.',
    },
  ],
};

export const config: TaskTypeConfig = {
  module: planningModule,
  builtinToolNames: ['__insert_tasks'],
};
