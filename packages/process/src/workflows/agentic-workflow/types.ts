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
  | 'output';

/**
 * Default driver role for each task type
 */
export const DEFAULT_DRIVER_ROLE: Record<TaskType, ModelRole> = {
  planning: 'plan',
  toolCall: 'instruct',
  think: 'instruct',
  verify: 'instruct',
  extractContext: 'instruct',
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
  output: { withInputs: false, withMessages: false, withMaterials: false },
};

// ---------------------------------------------------------------------------
// Task definition
// ---------------------------------------------------------------------------

/**
 * Agentic workflow task definition
 */
export interface AgenticTask {
  /** What this task should accomplish */
  instruction: string;
  /** Task type determining prompt construction and input contract */
  taskType: TaskType;
  /** Driver role override (defaults per task type) */
  driverRole?: ModelRole;
  /** Include ctx.inputs in data */
  withInputs?: boolean;
  /** Include ctx.messages in data */
  withMessages?: boolean;
  /** Include ctx.materials in data */
  withMaterials?: boolean;
}

// ---------------------------------------------------------------------------
// Execution log
// ---------------------------------------------------------------------------

/**
 * Record of a single task execution
 */
export interface AgenticTaskExecutionLog {
  taskType: TaskType;
  result: string;
  pendingToolCalls?: ToolCall[];
  metadata?: {
    usage?: QueryResult['usage'];
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Context for agentic workflow.
 *
 * Passed through the entire workflow lifecycle.
 * Each task type selects what it needs from this context.
 */
export interface AgenticWorkflowContext {
  /** Primary objective (passed as instruction to all tasks) */
  objective: string;
  /** Resolved user module (set by agenticProcess via resolve()) */
  userModule?: ResolvedModule;
  /** Structured input data */
  inputs?: Record<string, unknown>;
  /** Current task list */
  taskList?: AgenticTask[];
  /** Execution log of completed tasks */
  executionLog?: AgenticTaskExecutionLog[];
  /** Index of the currently executing task */
  currentTaskIndex?: number;
  /** Persisted state string from previous task execution */
  state?: string;
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
  /** Maximum tool call iterations per task (default: 10) */
  maxToolCalls?: number;
  /** Skip planning and use provided taskList (default: true) */
  enablePlanning?: boolean;
}
