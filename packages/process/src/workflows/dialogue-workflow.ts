import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { Logger } from '@modular-prompt/utils';
import type { LogEntry } from '@modular-prompt/utils';
import type { QueryResult } from '@modular-prompt/driver';
import {
  firstOfTwoPassResponse,
  secondOfTwoPassResponse,
  withTalkState
} from '../modules/dialogue.js';
import { withMaterials } from '../modules/material.js';
import type { DialogueContext } from '../modules/dialogue.js';
import type { MaterialContext } from '../modules/material.js';
import { WorkflowExecutionError, type WorkflowResult } from './types.js';
import { type DriverInput, resolveDriver } from './driver-input.js';
import { aggregateUsage, aggregateLogEntries } from './usage-utils.js';

const logger = new Logger({ prefix: 'process', context: 'dialogue' });

/**
 * Extended dialogue context with materials and preparation note
 */
export interface DialogueWorkflowContext extends DialogueContext, MaterialContext {
  preparationNote?: {
    content: string;
  };
}

/**
 * Options for dialogue workflow
 */
export interface DialogueWorkflowOptions {
  twoPass?: boolean;
  maintainState?: boolean;
  includematerials?: boolean;
}

/**
 * Dialogue workflow - handles conversational interactions with optional two-pass processing
 */
export async function dialogueProcess(
  driver: DriverInput,
  module: PromptModule<DialogueWorkflowContext>,
  context: DialogueWorkflowContext,
  options: DialogueWorkflowOptions = {}
): Promise<WorkflowResult<DialogueWorkflowContext>> {

  logger.info('[start] dialogue workflow');

  const { twoPass = false, maintainState = false, includematerials = false } = options;
  
  // Build the module based on options
  let workflowModule = module;
  
  if (maintainState) {
    workflowModule = merge(workflowModule, withTalkState);
  }
  
  if (includematerials && context.materials) {
    workflowModule = merge(workflowModule, withMaterials);
  }
  
  if (twoPass) {
    // First pass: Generate preparation notes
    const firstPassModule = merge(workflowModule, firstOfTwoPassResponse);
    const firstPassPrompt = compile(firstPassModule, context);
    logger.verbose('[prompt]', JSON.stringify(firstPassPrompt));

    let preparationNote: string;
    let firstPassResult: QueryResult;
    try {
      firstPassResult = await resolveDriver(driver, 'default').query(firstPassPrompt);
      logger.verbose('[output]', firstPassResult.content);

      // Check finish reason for dynamic failures
      if (firstPassResult.finishReason && firstPassResult.finishReason !== 'stop') {
        throw new WorkflowExecutionError(
          `Query failed with reason: ${firstPassResult.finishReason}`,
          context,
          {
            phase: 'firstPass',
            partialResult: '',
            finishReason: firstPassResult.finishReason
          }
        );
      }

      preparationNote = firstPassResult.content;
    } catch (error) {
      // If it's already a WorkflowExecutionError, re-throw
      if (error instanceof WorkflowExecutionError) {
        throw error;
      }
      // Preserve context on driver error for first pass
      throw new WorkflowExecutionError(error as Error, context, {
        phase: 'firstPass',
        partialResult: ''
      });
    }
    
    // Update context with preparation note
    const updatedContext: DialogueWorkflowContext = {
      ...context,
      preparationNote: { content: preparationNote }
    };
    
    // Second pass: Generate actual response
    const secondPassModule = merge(workflowModule, secondOfTwoPassResponse);
    const secondPassPrompt = compile(secondPassModule, updatedContext);
    logger.verbose('[prompt]', JSON.stringify(secondPassPrompt));

    let response: string;
    let secondPassResult: QueryResult;
    try {
      secondPassResult = await resolveDriver(driver, 'default').query(secondPassPrompt);
      logger.verbose('[output]', secondPassResult.content);

      // Check finish reason for dynamic failures
      if (secondPassResult.finishReason && secondPassResult.finishReason !== 'stop') {
        throw new WorkflowExecutionError(
          `Query failed with reason: ${secondPassResult.finishReason}`,
          updatedContext,
          {
            phase: 'secondPass',
            partialResult: preparationNote,
            finishReason: secondPassResult.finishReason
          }
        );
      }

      response = secondPassResult.content;
    } catch (error) {
      // If it's already a WorkflowExecutionError, re-throw
      if (error instanceof WorkflowExecutionError) {
        throw error;
      }
      // Preserve updated context (with preparation note) on driver error for second pass
      throw new WorkflowExecutionError(error as Error, updatedContext, {
        phase: 'secondPass',
        partialResult: preparationNote
      });
    }
    
    // Update messages with the response
    const finalContext: DialogueWorkflowContext = {
      ...updatedContext,
      messages: [
        ...(context.messages || []),
        { role: 'assistant', content: response }
      ]
    };

    logger.info('[end]');

    return {
      output: response,
      context: finalContext,
      consumedUsage: aggregateUsage([firstPassResult.usage, secondPassResult.usage]),
      responseUsage: secondPassResult.usage,
      logEntries: aggregateLogEntries([firstPassResult.logEntries, secondPassResult.logEntries]),
      errors: aggregateLogEntries([firstPassResult.errors, secondPassResult.errors]),
      metadata: {
        twoPass: true,
        preparationNoteLength: preparationNote.length
      }
    };
  } else {
    // Single pass response
    const prompt = compile(workflowModule, context);
    logger.verbose('[prompt]', JSON.stringify(prompt));

    let response: string;
    let singlePassResult: QueryResult;
    try {
      singlePassResult = await resolveDriver(driver, 'default').query(prompt);
      logger.verbose('[output]', singlePassResult.content);

      // Check finish reason for dynamic failures
      if (singlePassResult.finishReason && singlePassResult.finishReason !== 'stop') {
        throw new WorkflowExecutionError(
          `Query failed with reason: ${singlePassResult.finishReason}`,
          context,
          {
            phase: 'singlePass',
            partialResult: '',
            finishReason: singlePassResult.finishReason
          }
        );
      }

      response = singlePassResult.content;
    } catch (error) {
      // If it's already a WorkflowExecutionError, re-throw
      if (error instanceof WorkflowExecutionError) {
        throw error;
      }
      // Preserve context on driver error
      throw new WorkflowExecutionError(error as Error, context, {
        phase: 'singlePass',
        partialResult: ''
      });
    }
    
    // Update context with new message
    const finalContext: DialogueWorkflowContext = {
      ...context,
      messages: [
        ...(context.messages || []),
        { role: 'assistant', content: response }
      ]
    };

    logger.info('[end]');

    return {
      output: response,
      context: finalContext,
      consumedUsage: singlePassResult.usage,
      responseUsage: singlePassResult.usage,
      logEntries: singlePassResult.logEntries,
      errors: singlePassResult.errors,
      metadata: {
        twoPass: false
      }
    };
  }
}