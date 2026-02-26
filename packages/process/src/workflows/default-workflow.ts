import { compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { QueryOptions } from '@modular-prompt/driver';
import { WorkflowExecutionError, type AIDriver, type WorkflowResult } from './types.js';

/**
 * Options for default workflow
 */
export interface DefaultProcessOptions {
  queryOptions?: Partial<QueryOptions>;
}

/**
 * Default workflow - compiles a module with context and queries the driver.
 * This is the simplest process, wrapping compile + driver.query().
 */
export async function defaultProcess<TContext extends Record<string, any>>(
  driver: AIDriver,
  module: PromptModule<TContext>,
  context: TContext,
  options: DefaultProcessOptions = {}
): Promise<WorkflowResult<TContext>> {
  try {
    const compiled = compile(module, context);
    const result = await driver.query(compiled, options.queryOptions);

    return {
      output: result.content,
      context,
      metadata: {
        iterations: 1,
        tokensUsed: result.usage?.totalTokens,
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        usage: result.usage,
      },
    };
  } catch (error) {
    throw new WorkflowExecutionError(
      error instanceof Error ? error : new Error(String(error)),
      context,
      { phase: 'query' }
    );
  }
}
