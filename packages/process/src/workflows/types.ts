// Re-export types from driver package
export type { AIDriver, QueryResult, FinishReason } from '@modular-prompt/driver';
import type { FinishReason } from '@modular-prompt/driver';
import type { LogEntry } from '@modular-prompt/utils';

/**
 * Result of workflow execution
 */
export interface WorkflowResult<TContext> {
  output: string;
  context: TContext;  // 継続可能なコンテキスト
  /** 全 query() 呼び出しの合計 usage（リトライ含む）= 実コスト */
  consumedUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** 最終応答の usage = メッセージサイズの目安 */
  responseUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** ワークフロー実行中の全ログエントリ */
  logEntries?: LogEntry[];
  /** エラーレベルのログエントリ */
  errors?: LogEntry[];
  metadata?: {
    iterations?: number;
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

