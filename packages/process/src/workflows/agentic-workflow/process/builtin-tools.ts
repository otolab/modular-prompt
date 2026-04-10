/**
 * Agentic workflow 組み込みツール定義 (v2)
 *
 * - __register_task: タスク登録（planning タスクから利用可能、1タスクずつ呼び出し）
 * - __replan: 再プランニング要求（execution タスクから利用可能）
 * - __time: 現在時刻取得
 */

import type { ToolSpec, AgenticTask, TaskType } from '../types.js';
import type { ModelRole } from '../../driver-input.js';
import { EXECUTION_TASK_DEFS } from '../task-types/execution-tasks.js';

export const BUILTIN_TOOL_PREFIX = '__';

/** 有効な実行タスクタイプ（planning は除外 — モデルが指定する対象外） */
const VALID_TASK_TYPES = new Set<string>([...Object.keys(EXECUTION_TASK_DEFS), 'output']);

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
  withoutInputs?: boolean;
  withoutMessages?: boolean;
  withoutMaterials?: boolean;
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
    withoutInputs: {
      type: 'boolean',
      description: 'Exclude the original user input data from this Task. Default: false (inputs are included).',
    },
    withoutMessages: {
      type: 'boolean',
      description: 'Exclude the original user messages from this Task. Default: false (messages are included).',
    },
    withoutMaterials: {
      type: 'boolean',
      description: 'Exclude the original user materials from this Task. Default: false (materials are included).',
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
  const rawType = entry.taskType || 'think';
  if (!VALID_TASK_TYPES.has(rawType)) {
    const valid = [...VALID_TASK_TYPES].join(', ');
    throw new Error(`Invalid taskType "${rawType}". Valid types: ${valid}`);
  }
  const taskType = rawType as TaskType;
  const task: AgenticTask = {
    name: entry.name,
    instruction: entry.instruction,
    taskType,
    driverRole: entry.driverRole as ModelRole | undefined,
    withoutInputs: entry.withoutInputs,
    withoutMessages: entry.withoutMessages,
    withoutMaterials: entry.withoutMaterials,
  };

  const minInsertAt = currentIndex + 1;
  const requestedAt = typeof entry.insertAt === 'number' ? entry.insertAt : minInsertAt;
  const insertAt = Math.max(requestedAt, minInsertAt);
  taskList.splice(insertAt, 0, task);
}

/**
 * Planning フェーズ用の組み込みツールを生成
 *
 * __register_task ツールは1タスクずつ登録する。
 * 複数タスクの場合はモデルが複数回 tool call する。
 */
export function createPlanningTools(taskList: AgenticTask[], currentIndex: number): ToolSpec[] {
  let insertOffset = 0;
  return [{
    definition: {
      name: '__register_task',
      description: 'Register a single task into the workflow. Call once per task. Tasks are appended after the current position. Each task produces a specific deliverable and is executed by a separate AI instance.',
      parameters: TASK_ENTRY_SCHEMA,
    },
    handler: async (args) => {
      const entry = args as unknown as TaskEntry;
      if (!entry.instruction) {
        throw new Error('Provide an "instruction" field.');
      }
      registerTask(taskList, entry, currentIndex + insertOffset);
      insertOffset++;

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
 * Execution フェーズ用の組み込みツールを生成
 */
export function createExecutionBuiltinTools(
  _taskList: AgenticTask[],
  _currentIndex: number
): ToolSpec[] {
  return [
    replanTool,
    timeTool,
  ];
}
