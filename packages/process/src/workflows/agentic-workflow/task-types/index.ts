/**
 * Task type registry and shared utilities
 */

import type { PromptModule, MaterialElement } from '@modular-prompt/core';
import type { AgenticTask, AgenticWorkflowContext, TaskType, AgenticTaskExecutionLog } from '../types.js';
import { config as planningConfig } from './planning.js';
import { config as thinkConfig } from './think.js';
import { config as extractContextConfig } from './extract-context.js';
import { config as outputMessageConfig } from './output-message.js';
import { config as outputStructuredConfig } from './output-structured.js';

/**
 * Task type configuration
 */
export interface TaskTypeConfig {
  /** Build task type-specific prompt module */
  buildModule(
    task: AgenticTask,
    context: AgenticWorkflowContext,
    userModule: PromptModule<AgenticWorkflowContext>
  ): PromptModule<AgenticWorkflowContext>;

  /** List of builtin tool names available for this task type */
  builtinToolNames: string[];
}

/**
 * Task type registry
 */
const TASK_TYPE_REGISTRY: Record<TaskType, TaskTypeConfig> = {
  planning: planningConfig,
  think: thinkConfig,
  extractContext: extractContextConfig,
  outputMessage: outputMessageConfig,
  outputStructured: outputStructuredConfig,
};

/**
 * Get task type configuration
 */
export function getTaskTypeConfig(taskType: TaskType): TaskTypeConfig {
  return TASK_TYPE_REGISTRY[taskType];
}

/**
 * Convert execution log to MaterialElement array (previous task results)
 */
export function buildPreviousResultsMaterials(
  executionLog: AgenticTaskExecutionLog[]
): MaterialElement[] {
  return executionLog.map((log) => ({
    type: 'material' as const,
    id: `task-result-${log.taskId}`,
    title: `Task ${log.taskId} result`,
    content: log.result,
  }));
}

/**
 * Build task list display for methodology section
 */
export function buildTaskListDisplay(ctx: AgenticWorkflowContext): string {
  if (!ctx.taskList || ctx.taskList.length === 0) {
    return 'No tasks registered yet.';
  }

  const lines: string[] = [];
  const currentIndex = ctx.currentTaskIndex ?? -1;

  for (let i = 0; i < ctx.taskList.length; i++) {
    const task = ctx.taskList[i];
    let status: string;

    if (i < currentIndex) {
      status = '[completed]';
    } else if (i === currentIndex) {
      status = '[current]';
    } else {
      status = '[pending]';
    }

    lines.push(`- Task ${task.id} (${task.taskType}): ${task.description} ${status}`);
  }

  return lines.join('\n');
}

/**
 * Common methodology introduction text.
 * Used by all task types as the first element of their methodology section.
 */
export const METHODOLOGY_INTRO =
  'This workflow accomplishes the objective by executing tasks sequentially. Each task is handled by a separate AI instance that only sees its own instructions and the results of previous tasks. You are now responsible for the task marked [current] in the task list below.';
