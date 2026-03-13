import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import { formatLogContentParts, formatTaskDetails } from '../process/index.js';

/**
 * Execution phase module (freeform version) for agent workflow
 *
 * This version differs from the standard execution module:
 * - Uses planned dos/donts as instructions (not fixed process steps)
 * - Outputs freeform text (not structured JSON)
 * - Accumulates all previous step decisions
 *
 * Should be merged with agentic and user's module:
 *   merge(agentic, executionFreeform, userModule)
 */
export const executionFreeform: PromptModule<AgenticWorkflowContext> = {
  methodology: [
    (ctx: AgenticWorkflowContext) => {
      const currentTaskIndex = (ctx.executionLog?.length || 0) + 1;
      const totalTasks = ctx.plan?.tasks.length || 0;
      return [
        `- **Current Phase: Execution (Task ${currentTaskIndex}/${totalTasks})**`,
        '  - Execute only the current task of the execution plan.',
        '  - Follow the guidelines/constraints specified in the plan.',
        '  - Your text response becomes the task result.',
        '  - Use `__updateState` tool to pass information to the next task if needed.',
        ''
      ];
    }
  ],

  // Replace user's instructions with plan-based guidelines/constraints
  // Note: User's original instructions are omitted in agentic-workflow.ts
  instructions: [
    (ctx: AgenticWorkflowContext) => {
      const items: string[] = [];

      // Add current task description first
      if (ctx.currentTask?.description) {
        items.push(ctx.currentTask.description);
        items.push('');
      }

      // Add general execution guidelines
      items.push('');
      items.push('**Requirements:**');
      if (ctx.executionLog && ctx.executionLog.length > 0) {
        items.push('- Read and understand the previous task\'s decisions (shown in Data section below)');
        items.push('- Use that understanding to complete THIS task');
        items.push('- Produce only NEW content for this task');
        items.push('- Do NOT copy or reproduce the previous outputs');
      } else {
        items.push('- Focus on the current task instructions only');
      }
      items.push('- Concise output is acceptable');

      // Add guidelines and constraints
      if (ctx.currentTask) {
        const details = formatTaskDetails(ctx.currentTask);
        if (details.length > 0) {
          items.push('', ...details);
        }
      }

      return items;
    }
  ],

  state: [
    (ctx) => {
      const completed = ctx.executionLog?.length || 0;
      const total = ctx.plan?.tasks.length || 0;
      return `Progress: ${completed}/${total} tasks completed`;
    },
  ],

  materials: [
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0) {
        return null;
      }

      return ctx.executionLog.map((log, index) => {
        const parts: string[] = [];

        // Add the task's instructions first
        const task = ctx.plan?.tasks[index];
        if (task) {
          const instructionsParts: string[] = [];
          if (task.description) {
            instructionsParts.push(task.description);
          }
          const details = formatTaskDetails(task);
          if (details.length > 0) {
            instructionsParts.push('', ...details);
          }
          if (instructionsParts.length > 0) {
            parts.push(`[Instructions]\n${instructionsParts.join('\n')}`);
          }
        }

        parts.push(...formatLogContentParts(log));

        return {
          type: 'material' as const,
          id: `execution-decision-${log.taskId}`,
          title: `Previous task decision: ${log.taskId}`,
          content: parts.join('\n\n')
        };
      });
    }
  ],

  cue: [
    'IMPORTANT: Follow the Instructions above carefully.',
    'Output only what is required for THIS task based on the Requirements.'
  ]
};
