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
 * Convert execution log to a TextElement for the state section.
 * Each task result (deliverable) is formatted as a labeled block.
 */
export function buildDeliverables(
  executionLog: AgenticTaskExecutionLog[]
): TextElement {
  const content = executionLog
    .map((log, index) => {
      const taskName = log.taskName ? `${log.taskName}` : `Task ${index + 1}`;
      let text = `[${taskName}: ${log.taskType}] ${log.instruction}\n${log.result}`;
      if (log.toolCallLog?.length) {
        const toolResults = log.toolCallLog
          .map(tc => `  [tool: ${tc.name}] ${typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)}`)
          .join('\n');
        text += `\n${toolResults}`;
      }
      return text;
    })
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

    const label = task.name ? `[${task.name}] ` : '';
    lines.push(`${i + 1}. ${label}(${task.taskType}): ${task.instruction} ${status}`);
  }

  return lines.join('\n');
}

/**
 * Common module shared by all task types.
 * Provides workflow terms, methodology, and deliverable state.
 */
export const taskCommon: PromptModule<AgenticWorkflowContext> = {
  terms: [
    '- **Workflow**: A chain of deliverables that achieves the Objective.',
    '- **Task**: A unit of work that produces a specific deliverable. Each Task is executed by a separate AI instance.',
    '- **Deliverable**: The concrete output a Task produces. It becomes input for subsequent Tasks.',
    '- **Task Type**: Defines the role of a Task (e.g. think, act, verify). The prompt is pre-configured for each type.',
    '- **Focus**: The specific directive for the current Task — what deliverable to produce.',
  ],
  methodology: [
    `- We accomplish the Workflow's Objective by executing Tasks sequentially.`,
    {
      type: 'subsection' as const,
      title: 'Workflow Status / Current Task List',
      items: [
        (ctx: AgenticWorkflowContext) => buildTaskListDisplay(ctx),
      ],
    },
  ],
  instructions: [
    '- Do not perform work outside the scope of the current Task\'s Focus.',
    '- Refer to the deliverables from previous Tasks (shown in "Current State") as the basis for your work.',
    '- If the instructions are contradictory, there is insufficient information, or you lack the required knowledge — report the issue instead of producing a speculative result.',
    '- If the work is unnecessary given the current context, skip it and explain why. This is a valid and sufficient response.',
  ],
  state: [
    (ctx: AgenticWorkflowContext) => {
      if (!ctx.executionLog?.length) return null;
      return buildDeliverables(ctx.executionLog);
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
