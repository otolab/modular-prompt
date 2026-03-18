/**
 * Task type registry and shared utilities
 */

import type { PromptModule, MaterialElement, SectionContent } from '@modular-prompt/core';
import type { AgenticWorkflowContext, TaskType, AgenticTaskExecutionLog } from '../types.js';
import { config as planningConfig } from './planning.js';
import { config as outputConfig } from './output.js';
import { executionTaskConfigs } from './execution-tasks.js';

/**
 * Task type configuration
 */
export interface TaskTypeConfig {
  /** Static prompt module for this task type */
  module: PromptModule<AgenticWorkflowContext>;
  /** List of builtin tool names available for this task type */
  builtinToolNames: string[];
}

/**
 * Task type registry.
 * planning/output are special; execution tasks are auto-generated from EXECUTION_TASK_DEFS.
 */
const TASK_TYPE_REGISTRY: Record<TaskType, TaskTypeConfig> = {
  planning: planningConfig,
  ...executionTaskConfigs as Record<string, TaskTypeConfig>,
  output: outputConfig,
} as Record<TaskType, TaskTypeConfig>;

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
  return executionLog.map((log, index) => ({
    type: 'material' as const,
    id: `task-result-${index}`,
    title: `Task ${index + 1} result`,
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
      status = '**[current]**';
    } else {
      status = '[pending]';
    }

    lines.push(`${i + 1}. (${task.taskType}): ${task.instruction} ${status}`);
  }

  return lines.join('\n');
}

/**
 * Common module shared by all task types.
 * Provides workflow terms, methodology, and state information.
 */
export const taskCommon: PromptModule<AgenticWorkflowContext> = {
  terms: [
    '- **Task**: A unit of work in the workflow. Each Task is executed by a separate AI instance.',
    '- **Task Type**: Defines the role of a Task (e.g. think, toolCall, verify). The prompt is pre-configured for each type.',
    '- **Focus**: The specific directive for the current Task — what to concentrate on and accomplish.',
  ],
  methodology: [
    '- We accomplish the Objective by executing Tasks sequentially.',
    {
      type: 'subsection' as const,
      title: 'Workflow Status / Current Task List',
      items: [
        (ctx: AgenticWorkflowContext) => buildTaskListDisplay(ctx),
      ],
    },
  ],
};

/**
 * Extract static text content from SectionContent.
 * Only extracts strings, ignores DynamicContent and Elements.
 */
export function extractTextFromSection(section: SectionContent<any> | undefined): string {
  if (!section) return '';
  const items = Array.isArray(section) ? section : [section];
  const textParts: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      textParts.push(item);
    }
  }
  return textParts.join('\n');
}
