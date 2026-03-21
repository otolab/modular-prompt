/**
 * Task type registry and shared utilities
 */

import type { PromptModule, TextElement, SectionContent } from '@modular-prompt/core';
import type { AgenticWorkflowContext, TaskType, AgenticTaskExecutionLog } from '../types.js';
import { config as planningConfig } from './planning.js';
import { config as outputConfig } from './output.js';
import { executionTaskConfigs } from './execution-tasks.js';

/**
 * Task type configuration
 */
/**
 * maxTokens tier for task types.
 * Actual values: low=1024, middle=4096, high=8192 (capped by model maxOutputTokens).
 */
export type MaxTokensTier = 'low' | 'middle' | 'high';

// TODO: high tier should be capped by ModelSpec.maxOutputTokens at query time.
// Currently the driver's defaultOptions-level cap (validateAndClampMaxTokens) does not apply to per-query maxTokens.
export const MAX_TOKENS_VALUES: Record<MaxTokensTier, number> = {
  low: 2048,
  middle: 4096,
  high: 8192,
};

export interface TaskTypeConfig {
  /** Static prompt module for this task type */
  module: PromptModule<AgenticWorkflowContext>;
  /** List of builtin tool names available for this task type */
  builtinToolNames: string[];
  /** maxTokens tier (default: 'middle') */
  maxTokensTier: MaxTokensTier;
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
 * Convert execution log to a TextElement for preparationNote.
 * Each task result is formatted as a labeled block.
 */
export function buildPreviousResultsNote(
  executionLog: AgenticTaskExecutionLog[]
): TextElement {
  const content = executionLog
    .map((log, index) => `[Task ${index + 1}: ${log.taskType}] ${log.instruction}\n${log.result}`)
    .join('\n\n');
  return { type: 'text' as const, content };
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
  instructions: [
    '- Do not perform work outside the scope of the current Task.',
    '- If "Response Preparation Note" is present, it contains results from previously completed Tasks. Refer to it as the basis for your work.',
    '- If the instructions are contradictory, there is insufficient information, you lack the required knowledge, or the work is unnecessary — do not attempt to produce a speculative result. Instead, report that you did not perform the work and explain the reason. This is a valid and sufficient response.',
  ],
  terms: [
    '- **Task**: A unit of work in the workflow. Each Task is executed by a separate AI instance.',
    '- **Task Type**: Defines the role of a Task (e.g. think, toolCall, verify). The prompt is pre-configured for each type.',
    '- **Focus**: The specific directive for the current Task — what to concentrate on and accomplish.',
    '- **State**: Persistent information shared across Tasks. Updated via `__update_state` and visible to all subsequent Tasks in the "Current State" section.',
    '- **Response Preparation Note**: Results from all previously completed Tasks. Use this as your primary reference for what has already been done.',
  ],
  state: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.state) return null;
      return ctx.state;
    },
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
