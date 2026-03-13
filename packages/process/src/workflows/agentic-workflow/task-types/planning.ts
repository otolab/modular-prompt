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
import { buildTaskListDisplay } from './index.js';

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
      (ctx) => {
        const taskListDisplay = buildTaskListDisplay(ctx);
        return `**Current Phase: Planning**\n\nTask List:\n${taskListDisplay}`;
      },
      '',
      '- Generate an execution plan by breaking down the Objective and Instructions into 3-5 executable tasks.',
      '- Register each task using the `__task` tool provided.',
    ],

    instructions: [
      {
        type: 'subsection',
        title: 'Planning Requirements',
        items: [
          '- Break down the **Instructions shown in materials** into 3-5 concrete executable tasks',
          '- Register each task using the `__task` tool',
          '- Each task must have: id, description, taskType',
          '- The tasks should accomplish the Instructions in a logical sequence',
          '- Ensure logical flow between tasks',
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
