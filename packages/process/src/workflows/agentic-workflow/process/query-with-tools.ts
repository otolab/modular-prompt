/**
 * Tool calling loop implementation
 */

import type { ToolCall, ToolResultMessageElement, StandardMessageElement, CompiledPrompt, Element } from '@modular-prompt/core';
import type { ToolChoice, FinishReason } from '@modular-prompt/driver';
import { WorkflowExecutionError } from '../../types.js';
import type { AIDriver } from '../../types.js';
import type { QueryResult } from '@modular-prompt/driver';
import type { ToolSpec, ToolCallLog, AgenticWorkflowContext, AgenticLogger } from '../types.js';

/**
 * Execute tool calls and return ToolResultMessageElements
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  toolSpecs: ToolSpec[]
): Promise<ToolResultMessageElement[]> {
  const results: ToolResultMessageElement[] = [];
  for (const tc of toolCalls) {
    const spec = toolSpecs.find(s => s.definition.name === tc.name);
    if (!spec) {
      results.push({
        type: 'message', role: 'tool', toolCallId: tc.id, name: tc.name,
        kind: 'error', value: `Unknown tool: ${tc.name}`
      });
      continue;
    }
    try {
      const result = await spec.handler(tc.arguments);
      results.push({
        type: 'message', role: 'tool', toolCallId: tc.id, name: tc.name,
        kind: typeof result === 'string' ? 'text' : 'data', value: result
      });
    } catch (error) {
      results.push({
        type: 'message', role: 'tool', toolCallId: tc.id, name: tc.name,
        kind: 'error', value: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}

export interface QueryWithToolsOptions {
  toolChoice?: ToolChoice;
  maxIterations?: number;
  logger?: AgenticLogger;
  logPrefix?: string;
}

export interface QueryWithToolsResult {
  content: string;
  toolCallLog: ToolCallLog[];
  usage?: QueryResult['usage'];
  finishReason?: FinishReason;
}

/**
 * Run a query with tool calling loop.
 * Encapsulates conversation history management — callers only see the final result.
 */
export async function queryWithTools(
  driver: AIDriver,
  prompt: CompiledPrompt,
  tools: ToolSpec[],
  options: QueryWithToolsOptions = {}
): Promise<QueryWithToolsResult> {
  const { maxIterations = 10, logger, logPrefix = '' } = options;
  const toolDefs = tools.map(t => t.definition);

  let currentPrompt = prompt;
  const conversation: (StandardMessageElement | ToolResultMessageElement)[] = [];
  const toolCallLog: ToolCallLog[] = [];
  let content = '';
  let lastResult: { usage?: QueryWithToolsResult['usage']; finishReason?: FinishReason } = {};

  for (let i = 0; i <= maxIterations; i++) {
    const queryResult = await driver.query(currentPrompt, {
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      toolChoice: i === 0 ? (options.toolChoice ?? 'auto') : 'auto',
    });

    logger?.debug(`${logPrefix}AI generated:`, queryResult.content);

    if (queryResult.content) {
      content = queryResult.content;
    }
    lastResult = { usage: queryResult.usage, finishReason: queryResult.finishReason };

    if (!queryResult.toolCalls || queryResult.toolCalls.length === 0 || i === maxIterations) {
      break;
    }

    const toolResults = await executeToolCalls(queryResult.toolCalls, tools);

    // Record tool calls in log
    for (let j = 0; j < queryResult.toolCalls.length; j++) {
      toolCallLog.push({
        name: queryResult.toolCalls[j].name,
        arguments: queryResult.toolCalls[j].arguments,
        result: toolResults[j].value,
      });
    }

    logger?.debug(`${logPrefix}Tool calls:`, queryResult.toolCalls.map(tc => tc.name));

    // Build conversation for next round (internal detail)
    conversation.push(
      {
        type: 'message', role: 'assistant',
        content: queryResult.content || '',
        toolCalls: queryResult.toolCalls,
      } as StandardMessageElement,
      ...toolResults
    );

    currentPrompt = {
      ...prompt,
      data: [...(prompt.data || []), ...conversation as Element[]],
    };
  }

  return { content, toolCallLog, usage: lastResult.usage, finishReason: lastResult.finishReason };
}

export function rethrowAsWorkflowError(
  error: unknown,
  context: AgenticWorkflowContext,
  details: Record<string, unknown>
): never {
  if (error instanceof WorkflowExecutionError) throw error;
  throw new WorkflowExecutionError(error as Error, context, details);
}
