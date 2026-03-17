/**
 * Task type registry and shared utilities
 */

import type { PromptModule, MaterialElement, SectionContent } from '@modular-prompt/core';
import type { AgenticWorkflowContext, TaskType, AgenticTaskExecutionLog } from '../types.js';
import { config as planningConfig } from './planning.js';
import { config as thinkConfig } from './think.js';
import { config as extractContextConfig } from './extract-context.js';
import { config as outputMessageConfig } from './output-message.js';
import { config as outputStructuredConfig } from './output-structured.js';

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
    title: `Task(id=${log.taskId}) result`,
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

    lines.push(`- Task(id=${task.id}) (${task.taskType}): ${task.instruction} ${status}`);
  }

  return lines.join('\n');
}

/**
 * Common module shared by all task types.
 * Provides workflow terms, methodology, and state information.
 */
export const taskCommon: PromptModule<AgenticWorkflowContext> = {
  terms: [
    '- Objective: The final goal we are working to achieve',
    '- Plan: A sequence of Tasks we execute to accomplish the Objective',
    '- Task: A unit of work executed by one of our AI instances',
  ],
  methodology: [
    '- We accomplish the Objective by executing Tasks sequentially.',
    '- You are now working on the Task marked [current] below. Follow the "Instructions" section.',
    {
      type: 'subsection' as const,
      title: 'Workflow Status',
      items: [
        '- This is the current state of our workflow.',
        '- The [current] Task is what you are doing right now — do not re-register it.',
        (ctx: AgenticWorkflowContext) => buildTaskListDisplay(ctx),
      ],
    },
  ],
  state: [
    (ctx: AgenticWorkflowContext) => {
      return ctx.state || '(no saved state)';
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
