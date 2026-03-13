/**
 * Agentic workflow 組み込みツール定義
 *
 * Planning: __task でタスク登録
 * Execution: __updateState で状態引き継ぎ
 */

import type { ToolSpec, AgenticTask, BuiltinTaskType } from '../types.js';

export const BUILTIN_TOOL_PREFIX = '__';

/**
 * 組み込みツールかどうかを判定
 */
export function isBuiltinTool(name: string): boolean {
  return name.startsWith(BUILTIN_TOOL_PREFIX);
}

/**
 * Planning フェーズ用の組み込みツールを生成
 */
export function createPlanningTools(registeredTasks: AgenticTask[]): ToolSpec[] {
  return [{
    definition: {
      name: '__task',
      description: 'Register an execution task in the plan. Call this multiple times to build the task list.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique task ID (e.g., task-1, task-2)' },
          description: { type: 'string', description: 'What this task should accomplish' },
          taskType: {
            type: 'string',
            enum: ['think', 'context', 'character', 'summarize', 'custom'],
            description: 'Type of task: think=analysis, context=aggregation, character=persona message, summarize=summarization, custom=general',
          },
          guidelines: {
            type: 'array', items: { type: 'string' },
            description: 'Actions or principles to follow (2-4 items)',
          },
          constraints: {
            type: 'array', items: { type: 'string' },
            description: 'Limitations or prohibitions (1-3 items)',
          },
        },
        required: ['id', 'description'],
      },
    },
    handler: async (args) => {
      const task: AgenticTask = {
        id: args.id as string,
        description: args.description as string,
        taskType: (args.taskType as BuiltinTaskType) || 'custom',
        guidelines: args.guidelines as string[] | undefined,
        constraints: args.constraints as string[] | undefined,
      };
      registeredTasks.push(task);
      return `Task '${task.id}' registered: ${task.description}`;
    },
  }];
}

/**
 * Execution フェーズ用の組み込みツールを生成
 */
export function createExecutionBuiltinTools(
  stateRef: { current: string | undefined }
): ToolSpec[] {
  return [
    {
      definition: {
        name: '__updateState',
        description: 'Save state information to pass to the next task. Call this before finishing if there is context to carry over.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'State information to hand over to the next task' },
          },
          required: ['content'],
        },
      },
      handler: async (args) => {
        stateRef.current = args.content as string;
        return 'State updated successfully';
      },
    },
  ];
}
