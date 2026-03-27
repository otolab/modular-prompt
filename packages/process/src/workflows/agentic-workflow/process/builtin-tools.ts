/**
 * Agentic workflow 組み込みツール定義 (v2)
 *
 * - __register_tasks: タスク登録（planning タスクから利用可能）
 * - __replan: 再プランニング要求（execution タスクから利用可能）
 * - __time: 現在時刻取得
 */

import type { ToolDefinition } from '@modular-prompt/driver';
import type { ToolSpec, AgenticTask, TaskType } from '../types.js';
import type { ModelRole } from '../../driver-input.js';
import { EXECUTION_TASK_DEFS } from '../task-types/execution-tasks.js';

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
/**
 * 単一タスク定義の型
 */
interface TaskEntry {
  name?: string;
  instruction: string;
  taskType?: string;
  reason?: string;
  dep?: string[];
  driverRole?: string;
  withInputs?: boolean;
  withMessages?: boolean;
  withMaterials?: boolean;
  insertAt?: number;
}

const TASK_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short identifier for this task (e.g. "search", "analyze"). Used in dep references and display.' },
    instruction: { type: 'string', description: 'Description of the deliverable this task produces.' },
    taskType: {
      type: 'string',
      enum: [...Object.keys(EXECUTION_TASK_DEFS), 'output'],
      description: Object.entries(EXECUTION_TASK_DEFS)
        .map(([name, def]) => `${name}: ${def.toolDescription}`)
        .concat(['output: produces the final user-facing response (must be the last task)'])
        .join('. ') + '. Default: think',
    },
    reason: {
      type: 'string',
      description: 'Why this task is necessary — what gap it fills in the deliverable chain.',
    },
    dep: {
      type: 'array',
      items: { type: 'string' },
      description: 'Names of prior tasks whose deliverables this task depends on. Omit if the task has no dependencies.',
    },
    driverRole: {
      type: 'string',
      enum: ['default', 'thinking', 'instruct', 'chat', 'plan'],
      description: 'Driver role override. Defaults per task type.',
    },
    withInputs: {
      type: 'boolean',
      description: 'Pass the original user input data to this Task. Default: false for most types.',
    },
    withMessages: {
      type: 'boolean',
      description: 'Pass the original user messages (the conversation/request) to this Task. Default: false for most types. Set to true when the Task needs to read the raw user request.',
    },
    withMaterials: {
      type: 'boolean',
      description: 'Pass the original user materials to this Task. Default: false for most types.',
    },
    insertAt: {
      type: 'number',
      description: 'Position in the task list to insert at. If omitted, the task is scheduled as the next task. Values before the current task are ignored.',
    },
  },
  required: ['name', 'instruction', 'taskType', 'reason'],
} as const;

/**
 * TaskEntry からタスクを登録し、結果メッセージを返す
 * @param currentIndex 現在実行中のタスクのインデックス。insertAt がこれ以下の場合はクランプされる。
 */
function registerTask(taskList: AgenticTask[], entry: TaskEntry, currentIndex: number): void {
  const taskType = (entry.taskType as TaskType) || 'think';
  const task: AgenticTask = {
    name: entry.name,
    instruction: entry.instruction,
    taskType,
    driverRole: entry.driverRole as ModelRole | undefined,
    withInputs: entry.withInputs,
    withMessages: entry.withMessages,
    withMaterials: entry.withMaterials,
  };

  const minInsertAt = currentIndex + 1;
  const requestedAt = typeof entry.insertAt === 'number' ? entry.insertAt : minInsertAt;
  const insertAt = Math.max(requestedAt, minInsertAt);
  taskList.splice(insertAt, 0, task);
}

/**
 * Planning フェーズ用の組み込みツールを生成
 *
 * __register_tasks ツールは tasks 配列で複数タスクを一括登録する。
 * 単体の instruction 指定も後方互換として受け付ける。
 */
export function createPlanningTools(taskList: AgenticTask[], currentIndex: number): ToolSpec[] {
  return [{
    definition: {
      name: '__register_tasks',
      description: 'Register tasks into the existing workflow. Tasks are appended after the current position. Do not re-register tasks that already exist. Each task produces a specific deliverable and is executed by a separate AI instance.',
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
        throw new Error('Provide a non-empty "tasks" array.');
      }
      let insertOffset = 0;
      for (const entry of args.tasks as TaskEntry[]) {
        registerTask(taskList, entry, currentIndex + insertOffset);
        insertOffset++;
      }

      // Return full updated task list so the model can see the current plan
      return 'Updated task list:\n' + taskList
        .map((t, i) => `${i + 1}. ${t.name ? `[${t.name}] ` : ''}(${t.taskType}): ${t.instruction}`)
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
    const now = new Date();
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      utc: now.toISOString(),
      local: now.toLocaleString(locale, { timeZone }),
      locale,
      timeZone,
    };
  },
};

/**
 * 再プランニング要求ツール
 * ワークフロー側で検出され、実際の再プランニングが実行される
 */
const replanTool: ToolSpec = {
  definition: {
    name: '__replan',
    description: 'Request re-planning of the workflow. Triggers a new planning phase that considers completed deliverables and remaining tasks.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why re-planning is needed.',
        },
      },
    },
  },
  handler: async (args) => {
    // Return marker object. Actual re-planning is handled by the workflow.
    return {
      replan: true,
      reason: args.reason,
    };
  },
};

/**
 * ビルトインツールの定義一覧（planning向け情報提供用）
 *
 * planningタスクが適切なタスク設計を行うには、各タスクで利用可能な
 * ツールの全体像が必要。「できないことリスト」ではなく「ツールが
 * 存在するから使う」形で、必要なactタスクを計画させる。
 */
export function getBuiltinToolDefinitions(): ToolDefinition[] {
  return [
    timeTool.definition,
  ];
}

/**
 * Execution フェーズ用の組み込みツールを生成
 */
export function createExecutionBuiltinTools(
  taskList: AgenticTask[],
  currentIndex: number
): ToolSpec[] {
  return [
    replanTool,
    timeTool,
  ];
}
