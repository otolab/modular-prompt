import type { ToolDefinition, QueryResult } from '@modular-prompt/driver';

/**
 * Tool specification: definition for AI + handler for execution
 */
export interface ToolSpec {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * 組み込みタスクの種類
 */
export type BuiltinTaskType = 'think' | 'context' | 'character' | 'summarize' | 'custom';

/**
 * Agentic workflow task definition
 */
export interface AgenticTask {
  id: string;
  description: string;
  taskType?: BuiltinTaskType;
  guidelines?: string[];
  constraints?: string[];
}

/**
 * Tool call log entry
 */
export interface ToolCallLog {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

/**
 * Agentic workflow task execution log entry
 */
export interface AgenticTaskExecutionLog {
  taskId: string;
  taskType?: BuiltinTaskType;
  result: string;              // テキスト出力がそのまま入る
  toolCalls?: ToolCallLog[];
  state?: string;              // __updateState() で設定された値
  metadata?: {
    usage?: QueryResult['usage'];
    toolCallRounds: number;
  };
}

/**
 * Agentic workflow task plan
 */
export interface AgenticTaskPlan {
  tasks: AgenticTask[];
}

/**
 * Context for agentic workflow
 */
export interface AgenticWorkflowContext {
  objective: string;
  inputs?: Record<string, unknown>;
  state?: {
    content: string;
    usage?: number;
  };
  plan?: AgenticTaskPlan;
  executionLog?: AgenticTaskExecutionLog[];
  currentTask?: AgenticTask;
  phase?: 'planning' | 'execution' | 'integration' | 'complete';
}

/**
 * Logger interface for agentic workflow
 */
export interface AgenticLogger {
  debug: (...args: unknown[]) => void;
}

/**
 * Options for agentic workflow
 */
export interface AgenticWorkflowOptions {
  maxTasks?: number;              // 最大タスク数（デフォルト: 5）
  tools?: ToolSpec[];             // 利用可能な外部ツール
  maxToolCalls?: number;          // タスクあたりの最大ツール呼び出し数（デフォルト: 10）
  enablePlanning?: boolean;       // 計画フェーズの有効化（デフォルト: true）
  logger?: AgenticLogger;
}
