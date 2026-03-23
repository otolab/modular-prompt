/**
 * Tool calling loop implementation
 */

import type { ToolCall, ToolResultMessageElement, ResolvedModule } from '@modular-prompt/core';
import { distribute } from '@modular-prompt/core';
import type { ToolChoice, FinishReason, ToolDefinition } from '@modular-prompt/driver';
import { Logger } from '@modular-prompt/utils';
import { WorkflowExecutionError } from '../../types.js';
import type { AIDriver } from '../../types.js';
import type { QueryResult } from '@modular-prompt/driver';
import type { ToolSpec, ToolCallLog } from '../types.js';
import { isBuiltinTool } from './builtin-tools.js';

const logger = new Logger({ prefix: 'process', context: 'agentic' });

/**
 * Execute builtin tool calls and return ToolResultMessageElements
 */
async function executeBuiltinToolCalls(
  toolCalls: ToolCall[],
  builtinTools: ToolSpec[],
  logger: Logger
): Promise<ToolResultMessageElement[]> {
  const results: ToolResultMessageElement[] = [];
  for (const tc of toolCalls) {
    const spec = builtinTools.find(s => s.definition.name === tc.name);
    if (!spec) {
      results.push({
        type: 'message', role: 'tool', toolCallId: tc.id, name: tc.name,
        kind: 'error', value: `Unknown builtin tool: ${tc.name}`
      });
      continue;
    }
    try {
      const result = await spec.handler(tc.arguments);
      logger.info('[tool:result]', tc.name, result);
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
  /** External tool definitions (passed to driver, NOT executed internally) */
  externalToolDefs?: ToolDefinition[];
  toolChoice?: ToolChoice;
  /** Maximum output tokens per query */
  maxTokens?: number;
  logger?: Logger;
}

export interface QueryWithToolsResult {
  content: string;
  toolCallLog: ToolCallLog[];
  /** External tool calls that the LLM requested (not executed) */
  pendingToolCalls?: ToolCall[];
  usage?: QueryResult['usage'];
  finishReason?: FinishReason;
}

/**
 * Run a single query and handle tool calls.
 *
 * Each task queries the model exactly once.
 * Builtin tools (__ prefix) are executed and their results recorded.
 * External tool calls are returned as pending for the caller to handle.
 * Tool results are passed to subsequent tasks via preparationNote.
 */
export async function queryWithTools(
  driver: AIDriver,
  resolved: ResolvedModule,
  builtinTools: ToolSpec[],
  options: QueryWithToolsOptions = {}
): Promise<QueryWithToolsResult> {
  const { externalToolDefs = [], logger: qLogger = logger } = options;
  const allToolDefs = [
    ...builtinTools.map(t => t.definition),
    ...externalToolDefs,
  ];

  const toolCallLog: ToolCallLog[] = [];

  // Single query
  const prompt = distribute(resolved);
  const queryResult = await driver.query(prompt, {
    tools: allToolDefs.length > 0 ? allToolDefs : undefined,
    toolChoice: options.toolChoice ?? 'auto',
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
  });

  qLogger.verbose('[output]', queryResult.content);

  const content = queryResult.content || '';

  // No tool calls → return immediately
  if (!queryResult.toolCalls || queryResult.toolCalls.length === 0) {
    return { content, toolCallLog, usage: queryResult.usage, finishReason: queryResult.finishReason };
  }

  // Partition tool calls into builtin and external
  const builtinCalls = queryResult.toolCalls.filter(tc => isBuiltinTool(tc.name));
  const externalCalls = queryResult.toolCalls.filter(tc => !isBuiltinTool(tc.name));

  // Log tool calls
  for (const tc of queryResult.toolCalls) {
    qLogger.info('[tool:call]', tc.name, JSON.stringify(tc.arguments));
  }

  // Execute builtin tools and record results
  if (builtinCalls.length > 0) {
    const toolResults = await executeBuiltinToolCalls(builtinCalls, builtinTools, qLogger);
    for (let j = 0; j < builtinCalls.length; j++) {
      toolCallLog.push({
        name: builtinCalls[j].name,
        arguments: builtinCalls[j].arguments,
        result: toolResults[j].value,
      });
    }
  }

  // External tool calls → return as pending
  if (externalCalls.length > 0) {
    return {
      content, toolCallLog,
      pendingToolCalls: externalCalls,
      usage: queryResult.usage, finishReason: queryResult.finishReason,
    };
  }

  return { content, toolCallLog, usage: queryResult.usage, finishReason: queryResult.finishReason };
}

export function rethrowAsWorkflowError(
  error: unknown,
  context: unknown,
  details: Record<string, unknown>
): never {
  if (error instanceof WorkflowExecutionError) throw error;
  throw new WorkflowExecutionError(error as Error, context, details);
}
