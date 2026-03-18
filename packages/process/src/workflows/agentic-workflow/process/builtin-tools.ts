/**
 * Agentic workflow 組み込みツール定義 (v2)
 *
 * - __insert_tasks: タスク登録（全タスクから利用可能）
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
 * output タスクの直前のインデックスを返す
 */
function findDefaultInsertIndex(taskList: AgenticTask[]): number {
  const lastIndex = taskList.length - 1;
  const lastTask = taskList[lastIndex];
  if (lastTask && lastTask.taskType === 'output') {
    return lastIndex;
  }
  return taskList.length;
}

/**
 * Planning フェーズ用の組み込みツールを生成
 */
/**
 * 単一タスク定義の型
 */
interface TaskEntry {
  instruction: string;
  taskType?: string;
  driverRole?: string;
  withInputs?: boolean;
  withMessages?: boolean;
  withMaterials?: boolean;
  insertAt?: number;
}

const TASK_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    instruction: { type: 'string', description: 'Specific instruction for the task executor.' },
    taskType: {
      type: 'string',
      enum: ['toolCall', 'think', 'verify', 'extractContext', 'output'],
      description: 'toolCall: call external tools. think: general reasoning/analysis. verify: validate previous results. extractContext: extract from inputs/materials. output: generate final output (must be the last task). Default: think',
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
  required: ['instruction', 'taskType'],
} as const;

/**
 * TaskEntry からタスクを登録し、結果メッセージを返す
 */
function registerTask(taskList: AgenticTask[], entry: TaskEntry): void {
  const taskType = (entry.taskType as TaskType) || 'think';
  const task: AgenticTask = {
    instruction: entry.instruction,
    taskType,
    driverRole: entry.driverRole as ModelRole | undefined,
    withInputs: entry.withInputs,
    withMessages: entry.withMessages,
    withMaterials: entry.withMaterials,
  };

  const insertAt = typeof entry.insertAt === 'number' ? entry.insertAt : findDefaultInsertIndex(taskList);
  taskList.splice(insertAt, 0, task);
}

/**
 * Planning フェーズ用の組み込みツールを生成
 *
 * __insert_tasks ツールは tasks 配列で複数タスクを一括登録する。
 * 単体の instruction 指定も後方互換として受け付ける。
 */
export function createPlanningTools(taskList: AgenticTask[]): ToolSpec[] {
  return [{
    definition: {
      name: '__insert_tasks',
      description: 'Register tasks in the workflow. Each task is executed by a separate AI instance. Write specific, self-contained instructions.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of Task objects.',
            items: TASK_ENTRY_SCHEMA,
          },
        },
        required: ['tasks'],
      },
    },
    handler: async (args) => {
      if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
        return 'Error: Provide a non-empty "tasks" array.';
      }
      (args.tasks as TaskEntry[]).forEach(entry => registerTask(taskList, entry));

      // Return full updated task list so the model can see the current plan
      return 'Updated task list:\n' + taskList
        .map((t, i) => `${i + 1}. (${t.taskType}): ${t.instruction}`)
        .join('\n');
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
    createPlanningTools(taskList)[0], // __insert_tasks
    timeTool,
  ];
}
