import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { Logger } from '@modular-prompt/utils';
import type { LogEntry } from '@modular-prompt/utils';
import type { QueryResult } from '@modular-prompt/driver';
import { WorkflowExecutionError, type WorkflowResult } from './types.js';
import { type DriverInput, resolveDriver } from './driver-input.js';
import { aggregateUsage, aggregateLogEntries } from './usage-utils.js';

const logger = new Logger({ prefix: 'process', context: 'concat' });


/**
 * Context for concat processing workflow
 */
export interface ConcatProcessContext {
  chunks: Array<{
    content: string;
    partOf?: string;
    usage?: number;
    metadata?: Record<string, any>;
  }>;
  results?: string[];
  processedCount?: number;
}

/**
 * Options for concat processing workflow
 */
export interface ConcatProcessOptions {
  batchSize?: number;
  separator?: string;
  parallel?: boolean;
}

/**
 * Base module for concat processing
 */
const concatProcessing: PromptModule<ConcatProcessContext> = {
  objective: [
    'The assistant processes each provided chunk independently and produces output for it.',
    'Each chunk is a self-contained unit - process it without depending on other chunks.',
  ],
  methodology: [
    'Read the provided Input Chunk(s) carefully.',
    'Apply the specified processing to each chunk independently.',
    'Output the processing result directly.',
  ],
  materials: [
    (ctx) => {
      if (!ctx.chunks || ctx.chunks.length === 0) return null;
      return ctx.chunks.map((chunk, index) => ({
        type: 'chunk' as const,
        content: chunk.content,
        partOf: chunk.partOf || 'input',
        index,
        usage: chunk.usage
      }));
    }
  ],
};

/**
 * Concat processing workflow - processes chunks independently and concatenates results
 * Unlike stream processing which maintains state, concat treats each chunk independently
 */
export async function concatProcess(
  driver: DriverInput,
  module: PromptModule<ConcatProcessContext>,
  context: ConcatProcessContext,
  options: ConcatProcessOptions = {}
): Promise<WorkflowResult<ConcatProcessContext>> {

  logger.info('[start] concat workflow');

  const {
    batchSize = 1,
    separator = '\n',
    parallel = false
  } = options;

  if (!context.chunks || context.chunks.length === 0) {
    throw new Error('No chunks provided for processing');
  }

  // Use existing results or start fresh
  const results: string[] = context.results ? [...context.results] : [];
  let processedCount = context.processedCount || 0;
  const allUsages: (QueryResult['usage'] | undefined)[] = [];
  const allLogEntries: (LogEntry[] | undefined)[] = [];
  const allErrors: (LogEntry[] | undefined)[] = [];
  let lastUsage: QueryResult['usage'] | undefined;
  let lastThinkingContent: string | undefined;

  // Calculate starting point based on processed count
  const startIndex = processedCount;
  const remainingChunks = context.chunks.slice(startIndex);

  if (parallel && batchSize === 1) {
    // Process all remaining chunks in parallel
    const promises = remainingChunks.map(async (chunk, index) => {
      const chunkContext: ConcatProcessContext = {
        chunks: [chunk],
        processedCount: startIndex + index
      };

      const prompt = compile(merge(concatProcessing, module), chunkContext);
      logger.verbose('[prompt]', JSON.stringify(prompt));

      try {
        const result = await resolveDriver(driver, 'default').query(prompt);
        logger.verbose('[output]', result.content);

        // Check finish reason for dynamic failures
        if (result.finishReason && result.finishReason !== 'stop') {
          throw new WorkflowExecutionError(
            `Query failed with reason: ${result.finishReason}`,
            {
              ...context,
              results,
              processedCount: startIndex + index
            },
            {
              phase: 'parallel-process',
              partialResult: results.length > 0 ? results.join(separator) : '',
              finishReason: result.finishReason
            }
          );
        }

        return result;
      } catch (error) {
        // If it's already a WorkflowExecutionError, re-throw
        if (error instanceof WorkflowExecutionError) {
          throw error;
        }
        throw new WorkflowExecutionError(error as Error, {
          ...context,
          results,
          processedCount: startIndex + index
        }, {
          phase: 'parallel-process',
          partialResult: results.length > 0 ? results.join(separator) : ''
        });
      }
    });

    const parallelQueryResults = await Promise.all(promises);
    for (const qr of parallelQueryResults) {
      results.push(qr.content);
      allUsages.push(qr.usage);
      allLogEntries.push(qr.logEntries);
      allErrors.push(qr.errors);
      lastUsage = qr.usage;
      lastThinkingContent = qr.thinkingContent;
    }
    processedCount = context.chunks.length;
  } else {
    // Process chunks sequentially, possibly in batches
    for (let i = 0; i < remainingChunks.length; i += batchSize) {
      const batch = remainingChunks.slice(i, Math.min(i + batchSize, remainingChunks.length));
      
      const batchContext: ConcatProcessContext = {
        chunks: batch,
        results: results.length > 0 ? results : undefined,
        processedCount: startIndex + i
      };

      const prompt = compile(merge(concatProcessing, module), batchContext);
      logger.verbose('[prompt]', JSON.stringify(prompt));

      try {
        const queryResult = await resolveDriver(driver, 'default').query(prompt);
        logger.verbose('[output]', queryResult.content);
        
        // Check finish reason for dynamic failures
        if (queryResult.finishReason && queryResult.finishReason !== 'stop') {
          throw new WorkflowExecutionError(
            `Query failed with reason: ${queryResult.finishReason}`,
            {
              ...context,
              results,
              processedCount
            },
            {
              phase: 'sequential-process',
              partialResult: results.length > 0 ? results.join(separator) : undefined,
              finishReason: queryResult.finishReason
            }
          );
        }
        
        results.push(queryResult.content);
        allUsages.push(queryResult.usage);
        allLogEntries.push(queryResult.logEntries);
        allErrors.push(queryResult.errors);
        lastUsage = queryResult.usage;
        lastThinkingContent = queryResult.thinkingContent;
        processedCount = startIndex + i + batch.length;
      } catch (error) {
        // If it's already a WorkflowExecutionError, re-throw
        if (error instanceof WorkflowExecutionError) {
          throw error;
        }
        throw new WorkflowExecutionError(error as Error, {
          ...context,
          results,
          processedCount
        }, {
          phase: 'sequential-process',
          partialResult: results.length > 0 ? results.join(separator) : undefined
        });
      }
    }
  }

  // Concatenate results
  const output = results.join(separator);

  const finalContext: ConcatProcessContext = {
    ...context,
    results,
    processedCount
  };

  logger.info('[end]');

  return {
    output,
    context: finalContext,
    thinkingContent: lastThinkingContent,
    consumedUsage: aggregateUsage(allUsages),
    responseUsage: lastUsage,
    logEntries: aggregateLogEntries(allLogEntries),
    errors: aggregateLogEntries(allErrors),
    metadata: {
      chunksProcessed: processedCount,
      resultsCount: results.length,
      parallel
    }
  };
}