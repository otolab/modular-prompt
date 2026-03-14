import { compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { QueryOptions } from '@modular-prompt/driver';
import { Logger } from '@modular-prompt/utils';
import { WorkflowExecutionError, type WorkflowResult } from './types.js';
import { type DriverInput, resolveDriver } from './driver-input.js';

const logger = new Logger({ context: 'default' });

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
  driver: DriverInput,
  module: PromptModule<TContext>,
  context: TContext,
  options: DefaultProcessOptions = {}
): Promise<WorkflowResult<TContext>> {
  try {
    logger.info('[start] default workflow');
    const compiled = compile(module, context);
    logger.verbose('[prompt]', JSON.stringify(compiled));
    const result = await resolveDriver(driver, 'default').query(compiled, options.queryOptions);
    logger.verbose('[output]', result.content);
    logger.info('[end]');

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
