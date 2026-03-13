/**
 * Execution phase - task-by-task execution
 */

import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver } from '../../types.js';
import { WorkflowExecutionError } from '../../types.js';
import type { AgenticWorkflowContext, AgenticTask, AgenticTaskExecutionLog, ToolSpec, AgenticLogger } from '../types.js';
import { agentic } from './common.js';
import { queryWithTools, createExecutionBuiltinTools, rethrowAsWorkflowError, formatTaskDetails, formatLogContentParts } from '../process/index.js';

/**
 * Execution phase module for agent workflow
 */
export const execution: PromptModule<AgenticWorkflowContext> = {
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
      ];
    }
  ],

  instructions: [
    (ctx: AgenticWorkflowContext) => {
      const items: string[] = [];

      if (ctx.currentTask?.description) {
        items.push(ctx.currentTask.description, '');
      }

      items.push('**Requirements:**');
      if (ctx.executionLog && ctx.executionLog.length > 0) {
        items.push('- Read and understand the previous task\'s decisions (shown in Data section below)');
        items.push('- Use that understanding to complete THIS task');
        items.push('- Produce only NEW content for this task');
      } else {
        items.push('- Focus on the current task instructions only');
      }
      items.push('- Use available tools if needed to accomplish the task');
      items.push('- Concise output is acceptable');

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
    (ctx) => {
      if (ctx.state) {
        return `Handover from previous task: ${ctx.state.content}`;
      }
      return null;
    }
  ],

  materials: [
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0) {
        return null;
      }

      return ctx.executionLog.map((log, index) => {
        const parts: string[] = [];

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
          id: `previous-task-${log.taskId}`,
          title: `Previous task decision: ${log.taskId}`,
          content: parts.join('\n\n')
        };
      });
    }
  ],

  cue: [
    'Execute the current task. Your text response is the result.'
  ]
};

/**
 * Execute a single task
 */
export async function runTask(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  task: AgenticTask,
  externalTools: ToolSpec[],
  executionLog: AgenticTaskExecutionLog[],
  maxToolCalls: number,
  logger?: AgenticLogger
): Promise<AgenticTaskExecutionLog> {
  const executionModule = merge(agentic, execution, module);
  const taskContext: AgenticWorkflowContext = {
    ...context,
    currentTask: task,
    executionLog
  };
  const prompt = compile(executionModule, taskContext);

  const stateRef = { current: undefined as string | undefined };
  const builtinTools = createExecutionBuiltinTools(stateRef);
  const externalToolDefs = externalTools.map(t => t.definition);

  try {
    const result = await queryWithTools(driver, prompt, builtinTools, {
      externalToolDefs,
      maxIterations: maxToolCalls,
      logger,
      logPrefix: `Task ${task.id} - `,
    });

    if (result.finishReason && result.finishReason !== 'stop' && result.finishReason !== 'tool_calls') {
      throw new WorkflowExecutionError(
        `Task execution failed with reason: ${result.finishReason}`,
        taskContext,
        {
          phase: 'execution',
          partialResult: executionLog.map(log => log.result).join('\n\n'),
          finishReason: result.finishReason
        }
      );
    }

    return {
      taskId: task.id,
      taskType: task.taskType,
      result: result.content,
      pendingToolCalls: result.pendingToolCalls,
      state: stateRef.current,
      metadata: {
        usage: result.usage,
      }
    };
  } catch (error) {
    rethrowAsWorkflowError(error, taskContext, {
      phase: 'execution',
      partialResult: executionLog.map(log => log.result).join('\n\n')
    });
  }
}
