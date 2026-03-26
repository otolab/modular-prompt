import type { ToolDefinition, QueryResult, ToolCall } from '@modular-prompt/driver';
import type { ResolvedModule } from '@modular-prompt/core';
import type { ModelRole } from '../driver-input.js';

// ---------------------------------------------------------------------------
// Tool specification
// ---------------------------------------------------------------------------

/**
 * Tool specification: definition for AI + handler for execution
 */
export interface ToolSpec {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Tool call log entry (builtin tool execution record)
 */
export interface ToolCallLog {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

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
  | 'toolCall'
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
  toolCall: 'instruct',
  think: 'instruct',
  verify: 'instruct',
  extractContext: 'thinking',
  recall: 'instruct',
  determine: 'instruct',
  output: 'chat',
};

/**
 * Default withXxx options for each task type
 */
export const DEFAULT_DATA_OPTIONS: Record<TaskType, { withInputs: boolean; withMessages: boolean; withMaterials: boolean }> = {
  planning: { withInputs: true, withMessages: false, withMaterials: true },
  toolCall: { withInputs: false, withMessages: false, withMaterials: false },
  think: { withInputs: false, withMessages: false, withMaterials: false },
  verify: { withInputs: false, withMessages: false, withMaterials: false },
  extractContext: { withInputs: true, withMessages: true, withMaterials: true },
  recall: { withInputs: false, withMessages: false, withMaterials: false },
  determine: { withInputs: true, withMessages: true, withMaterials: true },
  output: { withInputs: false, withMessages: false, withMaterials: false },
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
  /** Include user inputs in data */
  withInputs?: boolean;
  /** Include user messages in data */
  withMessages?: boolean;
  /** Include user materials in data */
  withMaterials?: boolean;
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
    usage?: QueryResult['usage'];
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
  /** External tool definitions available to tasks (for planning visibility) */
  availableTools?: ToolDefinition[];
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
  /** External tools available to tasks */
  tools?: ToolSpec[];
  /** Skip planning and use provided taskList (default: true) */
  enablePlanning?: boolean;
  /** Include intermediate task results wrapped in <think> tags before the final output (default: false) */
  includeThinking?: boolean;
  /** Resume state from a previously suspended workflow */
  resumeState?: AgenticResumeState;
}
