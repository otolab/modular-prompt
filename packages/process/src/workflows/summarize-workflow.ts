import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { Logger } from '@modular-prompt/utils';
import { streamProcessing } from '../modules/stream-processing.js';
import { analyzeForSummary, contentSummarize } from '../modules/summarize.js';
import { WorkflowExecutionError, type WorkflowResult } from './types.js';
import { type DriverInput, resolveDriver } from './driver-input.js';

const logger = new Logger({ prefix: 'process', context: 'summarize' });

/**
 * Simple token estimation (roughly 4 characters per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Context for summarization workflow
 */
export interface SummarizeWorkflowContext {
  state?: {
    content: string;
    usage?: number;
  };
  chunks?: Array<{
    content: string;
    partOf?: string;
    usage?: number;
    attachments?: any[];
  }>;
  preparationNote?: {
    content: string;
  };
  targetTokens?: number;
  range?: {
    start: number;
    end: number;
  };
  analysisReport?: string;
  phase?: 'analysis' | 'summarization' | 'complete';
}

/**
 * Options for summarization workflow
 */
export interface SummarizeWorkflowOptions {
  targetTokens: number;
  enableAnalysis?: boolean;
}

/**
 * Summarization workflow - performs analysis and summarization with stream processing
 */
export async function summarizeProcess(
  driver: DriverInput,
  module: PromptModule<SummarizeWorkflowContext>,
  context: SummarizeWorkflowContext,
  options: SummarizeWorkflowOptions
): Promise<WorkflowResult<SummarizeWorkflowContext>> {

  logger.info('[start] summarize workflow');

  const {
    targetTokens,
    enableAnalysis = true
  } = options;
  
  let currentContext = { ...context };
  let analysisReport = currentContext.analysisReport || '';
  
  // Require chunks to be provided by caller
  if (!currentContext.chunks || currentContext.chunks.length === 0) {
    throw new Error('No chunks provided. Chunks must be prepared before calling the workflow.');
  }
  
  // Phase 1: Analysis (optional)
  if (enableAnalysis && !currentContext.analysisReport) {
    currentContext.phase = 'analysis';
    const analysisModule = merge(streamProcessing, analyzeForSummary);
    
    // Process chunks for analysis
    let analysisState = '';
    for (let i = 0; i < currentContext.chunks.length; i += 3) {
      const batchContext: SummarizeWorkflowContext = {
        ...currentContext,
        state: { content: analysisState, usage: estimateTokens(analysisState) },
        range: { start: i, end: Math.min(i + 3, currentContext.chunks.length) }
      };
      
      const prompt = compile(analysisModule, batchContext);
      logger.verbose('[prompt]', JSON.stringify(prompt));

      try {
        const queryResult = await resolveDriver(driver, 'default').query(prompt);
        logger.verbose('[output]', queryResult.content);
        
        // Check finish reason for dynamic failures
        if (queryResult.finishReason && queryResult.finishReason !== 'stop') {
          throw new WorkflowExecutionError(
            `Query failed with reason: ${queryResult.finishReason}`,
            {
              ...currentContext,
              state: { content: analysisState, usage: estimateTokens(analysisState) },
              range: { start: i, end: Math.min(i + 3, currentContext.chunks.length) },
              analysisReport: analysisState
            },
            {
              phase: 'analysis',
              partialResult: analysisState,
              finishReason: queryResult.finishReason
            }
          );
        }
        
        analysisState = queryResult.content;
      } catch (error) {
        // If it's already a WorkflowExecutionError, re-throw
        if (error instanceof WorkflowExecutionError) {
          throw error;
        }
        // Preserve context and phase info on driver error
        throw new WorkflowExecutionError(error as Error, {
          ...currentContext,
          state: { content: analysisState, usage: estimateTokens(analysisState) },
          range: { start: i, end: Math.min(i + 3, currentContext.chunks.length) },
          analysisReport: analysisState
        }, {
          phase: 'analysis',
          partialResult: analysisState
        });
      }
    }
    
    analysisReport = analysisState;
    currentContext.preparationNote = { content: analysisReport };
    currentContext.analysisReport = analysisReport;
  }
  
  // Phase 2: Summarization
  currentContext.phase = 'summarization';
  const summarizeModule = merge(
    streamProcessing,
    contentSummarize,
    module
  );
  
  // Process chunks for summarization
  let summaryState = currentContext.state?.content || '';
  
  // Calculate starting position
  const startPosition = currentContext.range?.end || 0;
  
  for (let i = startPosition; i < currentContext.chunks.length; i += 3) {
    const batchContext: SummarizeWorkflowContext = {
      ...currentContext,
      state: { 
        content: summaryState, 
        usage: estimateTokens(summaryState) 
      },
      range: { 
        start: i, 
        end: Math.min(i + 3, currentContext.chunks.length) 
      },
      targetTokens,
      preparationNote: currentContext.preparationNote
    };
    
    const prompt = compile(summarizeModule, batchContext);
    logger.verbose('[prompt]', JSON.stringify(prompt));

    try {
      const queryResult = await resolveDriver(driver, 'default').query(prompt);
      logger.verbose('[output]', queryResult.content);
      
      // Check finish reason for dynamic failures
      if (queryResult.finishReason && queryResult.finishReason !== 'stop') {
        throw new WorkflowExecutionError(
          `Query failed with reason: ${queryResult.finishReason}`,
          {
            ...currentContext,
            state: { content: summaryState, usage: estimateTokens(summaryState) },
            range: { start: i, end: Math.min(i + 3, currentContext.chunks.length) }
          },
          {
            phase: 'summarization',
            partialResult: summaryState,
            finishReason: queryResult.finishReason
          }
        );
      }
      
      summaryState = queryResult.content;
    } catch (error) {
      // If it's already a WorkflowExecutionError, re-throw
      if (error instanceof WorkflowExecutionError) {
        throw error;
      }
      // Preserve context and phase info on driver error
      throw new WorkflowExecutionError(error as Error, {
        ...currentContext,
        state: { content: summaryState, usage: estimateTokens(summaryState) },
        range: { start: i, end: Math.min(i + 3, currentContext.chunks.length) }
      }, {
        phase: 'summarization',
        partialResult: summaryState
      });
    }
    
    // Check if we're approaching target size
    if (estimateTokens(summaryState) > targetTokens * 4) {  // Rough char to token estimate
      // Aggressive reduction needed - will be handled by the module
    }
  }
  
  // Final context
  const finalContext: SummarizeWorkflowContext = {
    ...currentContext,
    phase: 'complete',
    state: {
      content: summaryState,
      usage: estimateTokens(summaryState)
    },
    analysisReport,
    range: undefined // Processing complete
  };

  logger.info('[end]');

  return {
    output: summaryState,
    context: finalContext,
    metadata: {
      analysisEnabled: enableAnalysis,
      finalLength: estimateTokens(summaryState),
      targetTokens
    }
  };
}