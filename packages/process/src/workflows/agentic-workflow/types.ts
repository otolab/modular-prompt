import type { ToolDefinition } from '@modular-prompt/driver';

/**
 * Tool specification: definition for AI + handler for execution
 */
export interface ToolSpec {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Agentic workflow step definition
 */
export interface AgenticStep {
  id: string;
  description: string;
  guidelines?: string[];  // Actions or principles to follow in this step
  constraints?: string[]; // Limitations or prohibitions for this step
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
 * Agentic workflow execution log entry
 */
export interface AgenticExecutionLog {
  stepId: string;
  reasoning: string;    // Thought process and analysis
  result: string;       // Execution result
  toolCalls?: ToolCallLog[];
  metadata?: any;
}

/**
 * Agentic workflow plan (structured output from planning phase)
 */
export interface AgenticPlan {
  steps: AgenticStep[];
}

/**
 * Context for agentic workflow
 */
export interface AgenticWorkflowContext {
  objective: string;              // 達成目標
  inputs?: any;                   // 入力データ
  state?: {                       // 前ステップからの申し送り事項
    content: string;
    usage?: number;
  };
  plan?: AgenticPlan;               // 実行計画
  executionLog?: AgenticExecutionLog[];  // 実行履歴
  currentStep?: AgenticStep;        // 現在実行中のステップ
  availableTools?: ToolDefinition[];  // 利用可能なツール一覧（planningモジュール用）
  phase?: 'planning' | 'execution' | 'integration' | 'complete';
}

/**
 * Options for agentic workflow
 */
export interface AgenticWorkflowOptions {
  maxSteps?: number;              // 最大ステップ数（デフォルト: 5）
  tools?: ToolSpec[];             // 利用可能なツール
  maxToolCalls?: number;          // ステップあたりの最大ツール呼び出し数（デフォルト: 10）
  enablePlanning?: boolean;       // 計画フェーズの有効化（デフォルト: true）
  useFreeformExecution?: boolean; // Use freeform execution module (デフォルト: false)
  logger?: any;                   // Logger instance for debug output
}
