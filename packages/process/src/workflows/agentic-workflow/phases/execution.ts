/**
 * Execution phase - task-by-task execution
 */

import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver } from '../../types.js';
import { WorkflowExecutionError } from '../../types.js';
import type { AgenticWorkflowContext, AgenticTask, AgenticTaskExecutionLog, ToolSpec, AgenticLogger } from '../types.js';
import { agentic } from './common.js';
import { executionFreeform } from './execution-freeform.js';
import { queryWithTools, createExecutionBuiltinTools, isBuiltinTool, rethrowAsWorkflowError, formatTaskDetails, formatToolCall } from '../process/index.js';

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
  useFreeform: boolean,
  maxToolCalls: number,
  logger?: AgenticLogger
): Promise<AgenticTaskExecutionLog> {
  const executionPhaseModule = useFreeform ? executionFreeform : execution;
  const distributed = useFreeform ? { ...module, instructions: undefined } : module;

  const executionModule = merge(agentic, executionPhaseModule, distributed);
  const taskContext: AgenticWorkflowContext = {
    ...context,
    currentTask: task,
    executionLog
  };
  const prompt = compile(executionModule, taskContext);

  const stateRef = { current: undefined as string | undefined };
  const builtinTools = createExecutionBuiltinTools(stateRef);
  const allTools = [...externalTools, ...builtinTools];

  try {
    const result = await queryWithTools(driver, prompt, allTools, {
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

    // Filter out builtin tool calls from log
    const externalToolCalls = result.toolCallLog.filter(tc => !isBuiltinTool(tc.name));

    return {
      taskId: task.id,
      taskType: task.taskType,
      result: result.content,
      toolCalls: externalToolCalls.length > 0 ? externalToolCalls : undefined,
      state: stateRef.current,
      metadata: {
        usage: result.usage,
        toolCallRounds: result.toolCallLog.length > 0
          ? result.toolCallLog.filter(tc => !isBuiltinTool(tc.name)).length > 0
            ? Math.ceil(externalToolCalls.length)
            : 0
          : 0
      }
    };
  } catch (error) {
    rethrowAsWorkflowError(error, taskContext, {
      phase: 'execution',
      partialResult: executionLog.map(log => log.result).join('\n\n')
    });
  }
}
