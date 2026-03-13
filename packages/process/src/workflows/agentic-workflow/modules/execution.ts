import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext, AgenticTask } from '../types.js';
import { formatTaskDetails, formatToolCall } from '../format-helpers.js';

/**
 * Execution phase module for agent workflow
 * Phase-specific definitions for executing a single step
 *
 * Should be merged with agentic and user's module:
 *   merge(agentic, execution, userModule)
 */
export const execution: PromptModule<AgenticWorkflowContext> = {
  methodology: [
    '',
    '**Current Phase: Execution**',
    '',
    '- Execute only the current task of the execution plan.',
    '- Your text response becomes the result of this task.',
    '- Use `__updateState` tool to pass information to the next task if needed.'
  ],

  instructions: [
    {
      type: 'subsection',
      title: 'Execution Phase Process',
      items: [
        '- Focus solely on completing the current task',
        '- Use available tools if needed to accomplish the task',
        '- Your text response becomes the task result',
        '- Use `__updateState` tool to pass handover information to the next task'
      ]
    },
    {
      type: 'subsection',
      title: 'Execution Plan',
      items: [
        (ctx) => {
          if (!ctx.plan) {
            return null;
          }

          const currentTaskId = ctx.currentTask?.id;

          return ctx.plan.tasks.map((task: AgenticTask) => {
            const baseText = task.description;

            // For currently executing task, show guidelines/constraints
            if (task.id === currentTaskId) {
              const details: string[] = [`- **${baseText}** ← **[Currently executing]**`];
              details.push(...formatTaskDetails(task).map(line => `  ${line}`));
              return details;
            }

            return `- ${baseText}`;
          }).flat();
        }
      ]
    }
  ],

  state: [
    (ctx) => {
      const completed = ctx.executionLog?.length || 0;
      const total = ctx.plan?.tasks.length || 0;
      return `Progress: ${completed}/${total} tasks completed`;
    },
    (ctx) => {
      if (ctx.state) {
        return `Handover from previous task: ${ctx.state.content}`;
      }
      return null;
    }
  ],

  materials: [
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0 || !ctx.plan) {
        return null;
      }

      return ctx.executionLog.map((log) => {
        const task = ctx.plan!.tasks.find((t: AgenticTask) => t.id === log.taskId);

        const contentParts: string[] = [];

        if (task) {
          contentParts.push('## Instructions', '', task.description, '');
          const details = formatTaskDetails(task);
          if (details.length > 0) {
            contentParts.push(...details, '');
          }
        }

        contentParts.push('## Result', '', log.result);

        if (log.toolCalls && log.toolCalls.length > 0) {
          contentParts.push('', '**Tool Calls:**');
          contentParts.push(...log.toolCalls.map(formatToolCall));
        }

        if (log.state) {
          contentParts.push('', '**State:**', log.state);
        }

        return {
          type: 'material' as const,
          id: `previous-task-${log.taskId}`,
          title: `Previous task decision: ${log.taskId}`,
          content: contentParts.join('\n')
        };
      });
    }
  ],

  cue: [
    'Execute the current task. Your text response is the result.'
  ]
};
