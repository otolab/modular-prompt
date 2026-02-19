// Re-export types from driver package
export type { AIDriver, QueryResult, FinishReason } from '@modular-prompt/driver';
import type { FinishReason } from '@modular-prompt/driver';

/**
 * Result of workflow execution
 */
export interface WorkflowResult<TContext> {
  output: string;
  context: TContext;  // 継続可能なコンテキスト
  metadata?: {
    iterations?: number;
    tokensUsed?: number;
    [key: string]: any;
  };
}

/**
 * Error with recoverable context
 */
export interface WorkflowError<TContext> extends Error {
  context: TContext;  // エラー時点のコンテキスト（再開可能）
  partialResult?: string;   // 部分的な出力
  phase?: string;     // エラーが発生したフェーズ
  finishReason?: FinishReason;  // 終了理由
}

/**
 * Workflow error implementation with context preservation
 */
export class WorkflowExecutionError<TContext = any> extends Error implements WorkflowError<TContext> {
  public context: TContext;
  public partialResult?: string;
  public phase?: string;
  public finishReason?: FinishReason;
  
  constructor(
    originalError: Error | string,
    context: TContext,
    options?: {
      partialResult?: string;
      phase?: string;
      finishReason?: FinishReason;
    }
  ) {
    const message = typeof originalError === 'string' 
      ? originalError 
      : originalError.message;
    
    super(message);
    this.name = 'WorkflowExecutionError';
    this.context = context;
    this.partialResult = options?.partialResult;
    this.phase = options?.phase;
    this.finishReason = options?.finishReason;
    
    // Preserve original stack trace if available
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack;
    }
  }
}

