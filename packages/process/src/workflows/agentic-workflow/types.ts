import type { ToolDefinition, QueryResult, ToolCall } from '@modular-prompt/driver';
import type { ResolvedModule } from '@modular-prompt/core';
import type { LogEntry } from '@modular-prompt/utils';
import type { ModelRole } from '../driver-input.js';

// Import shared tool types (re-exported below for backward compatibility)
import type { ToolSpec, ToolCallLog } from '../types.js';
export type { ToolSpec, ToolCallLog };

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

/**
 * Built-in task types.
 *
 * Each type defines its own input contract:
 * - What context data it receives (instructions vs data)
 * - What tools are available
 * - Default driver role
 */
export type TaskType =
  | 'planning'
  | 'act'
  | 'think'
  | 'verify'
  | 'extractContext'
  | 'recall'
  | 'determine'
  | 'output';

/**
 * Default driver role for each task type.
 * planning/output are hardcoded; execution tasks are derived from EXECUTION_TASK_DEFS.
 */
export const DEFAULT_DRIVER_ROLE: Record<TaskType, ModelRole> = {
  planning: 'plan',
  act: 'instruct',
  think: 'instruct',
  verify: 'instruct',
  extractContext: 'thinking',
  recall: 'instruct',
  determine: 'instruct',
  output: 'chat',
};


// ---------------------------------------------------------------------------
// Task definition
// ---------------------------------------------------------------------------

/**
 * Agentic workflow task definition
 */
export interface AgenticTask {
  /** Short identifier for this task (used in dep references and display) */
  name?: string;
  /** What this task should accomplish */
  instruction: string;
  /** Task type determining prompt construction and input contract */
  taskType: TaskType;
  /** Driver role override (defaults per task type) */
  driverRole?: ModelRole;
  /** Exclude user inputs from data (default: false = inputs are included) */
  withoutInputs?: boolean;
  /** Exclude user messages from data (default: false = messages are included) */
  withoutMessages?: boolean;
  /** Exclude user materials from data (default: false = materials are included) */
  withoutMaterials?: boolean;
}

// ---------------------------------------------------------------------------
// Execution log
// ---------------------------------------------------------------------------

/**
 * Record of a single task execution
 */
export interface AgenticTaskExecutionLog {
  taskName?: string;
  taskType: TaskType;
  instruction: string;
  result: string;
  /** Builtin tool call results from this task */
  toolCallLog?: ToolCallLog[];
  pendingToolCalls?: ToolCall[];
  metadata?: {
    /** 全 query() 呼び出しの合計 usage（リトライ含む） */
    consumedUsage?: QueryResult['usage'];
    /** 最終クエリの usage */
    responseUsage?: QueryResult['usage'];
    /** 全クエリの logEntries */
    logEntries?: LogEntry[];
    /** エラーレベルのログエントリ */
    errors?: LogEntry[];
  };
}

// ---------------------------------------------------------------------------
// Context (internal)
// ---------------------------------------------------------------------------

/**
 * Internal context for agentic workflow.
 *
 * This is NOT the user-facing API. Users pass their own context type `T`
 * (for module DynamicContent resolution) and optionally an `AgenticResumeState`
 * (via options) to resume a previously suspended workflow.
 */
export interface AgenticWorkflowContext {
  /** Resolved user module (set by agenticProcess via resolve()) */
  userModule?: ResolvedModule;
  /** Current task list */
  taskList?: AgenticTask[];
  /** Execution log of completed tasks */
  executionLog?: AgenticTaskExecutionLog[];
  /** Index of the currently executing task */
  currentTaskIndex?: number;
}

// ---------------------------------------------------------------------------
// Resume state (public)
// ---------------------------------------------------------------------------

/**
 * State for resuming a previously suspended agentic workflow.
 *
 * Returned by agenticProcess in the result and can be passed back
 * via options.resumeState to continue execution.
 */
export interface AgenticResumeState {
  /** Task list from the previous run */
  taskList?: AgenticTask[];
  /** Execution log from the previous run */
  executionLog?: AgenticTaskExecutionLog[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for agentic workflow
 */
export interface AgenticWorkflowOptions {
  /** Maximum number of tasks (default: 10) */
  maxTasks?: number;
  /** External tool definitions available to tasks */
  tools?: ToolDefinition[];
  /** Skip planning and use provided taskList (default: true) */
  enablePlanning?: boolean;
  /** Include intermediate task results wrapped in <think> tags before the final output (default: false) */
  includeThinking?: boolean;
  /** Resume state from a previously suspended workflow */
  resumeState?: AgenticResumeState;
}
