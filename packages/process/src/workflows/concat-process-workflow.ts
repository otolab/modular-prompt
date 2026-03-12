import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { WorkflowExecutionError, type WorkflowResult } from './types.js';
import { type DriverInput, resolveDriver } from './driver-input.js';


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

      try {
        const result = await resolveDriver(driver, 'default').query(prompt);
        
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
        
        return result.content;
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

    const parallelResults = await Promise.all(promises);
    results.push(...parallelResults);
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

      try {
        const queryResult = await resolveDriver(driver, 'default').query(prompt);
        
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

  return {
    output,
    context: finalContext,
    metadata: {
      chunksProcessed: processedCount,
      resultsCount: results.length,
      parallel
    }
  };
}