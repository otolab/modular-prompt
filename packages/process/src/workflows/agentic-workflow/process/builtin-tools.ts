/**
 * Agentic workflow 組み込みツール定義 (v2)
 *
 * - __task: タスク登録（全タスクから利用可能）
 * - __time: 現在時刻取得
 */

import type { ToolSpec, AgenticTask, TaskType } from '../types.js';
import { DEFAULT_DRIVER_ROLE } from '../types.js';
import type { ModelRole } from '../../driver-input.js';

export const BUILTIN_TOOL_PREFIX = '__';

/**
 * 組み込みツールかどうかを判定
 */
export function isBuiltinTool(name: string): boolean {
  return name.startsWith(BUILTIN_TOOL_PREFIX);
}

/**
 * taskList 内の最大 id + 1 を返す（自動採番）
 */
function nextTaskId(taskList: AgenticTask[]): number {
  return taskList.length > 0 ? Math.max(...taskList.map(t => t.id)) + 1 : 1;
}

/**
 * output タスクの直前のインデックスを返す
 */
function findDefaultInsertIndex(taskList: AgenticTask[]): number {
  const lastIndex = taskList.length - 1;
  const lastTask = taskList[lastIndex];
  if (lastTask && (lastTask.taskType === 'outputMessage' || lastTask.taskType === 'outputStructured')) {
    return lastIndex;
  }
  return taskList.length;
}

/**
 * Planning フェーズ用の組み込みツールを生成
 */
export function createPlanningTools(taskList: AgenticTask[]): ToolSpec[] {
  return [{
    definition: {
      name: '__task',
      description: 'Register a task in the workflow. Call this multiple times to build the task list. Tasks are inserted before the output task by default.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What this task should accomplish' },
          taskType: {
            type: 'string',
            enum: ['planning', 'think', 'extractContext', 'outputMessage', 'outputStructured'],
            description: 'Type of task. Default: think',
          },
          driverRole: {
            type: 'string',
            enum: ['default', 'thinking', 'instruct', 'chat', 'plan'],
            description: 'Driver role override. Defaults per task type.',
          },
          withInputs: {
            type: 'boolean',
            description: 'Include ctx.inputs in data. Defaults per task type.',
          },
          withMessages: {
            type: 'boolean',
            description: 'Include ctx.messages in data. Defaults per task type.',
          },
          withMaterials: {
            type: 'boolean',
            description: 'Include ctx.materials in data. Defaults per task type.',
          },
          insertAt: {
            type: 'number',
            description: 'Index to insert at. Defaults to just before the output task.',
          },
        },
        required: ['description'],
      },
    },
    handler: async (args) => {
      const taskType = (args.taskType as TaskType) || 'think';
      const id = nextTaskId(taskList);
      const task: AgenticTask = {
        id,
        description: args.description as string,
        taskType,
        driverRole: args.driverRole as ModelRole | undefined,
        withInputs: args.withInputs as boolean | undefined,
        withMessages: args.withMessages as boolean | undefined,
        withMaterials: args.withMaterials as boolean | undefined,
      };

      const insertAt = typeof args.insertAt === 'number' ? args.insertAt : findDefaultInsertIndex(taskList);
      taskList.splice(insertAt, 0, task);

      return `Task ${id} registered: ${task.description}`;
    },
  }];
}

/**
 * 現在時刻を返す組み込みツール
 */
const timeTool: ToolSpec = {
  definition: {
    name: '__time',
    description: 'Get the current date and time.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  handler: async () => {
    return new Date().toISOString();
  },
};

/**
 * Execution フェーズ用の組み込みツールを生成
 */
export function createExecutionBuiltinTools(
  taskList: AgenticTask[]
): ToolSpec[] {
  return [
    createPlanningTools(taskList)[0], // __task
    timeTool,
  ];
}
