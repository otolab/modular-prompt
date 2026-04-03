/**
 * Tool calling loop implementation
 *
 * Handles builtin tool execution with error-based retry.
 * When a tool call fails (builtin error or invalid tool name),
 * the error result is fed back to the model for correction.
 */

import type { ToolCall, ToolResultMessageElement, StandardMessageElement, ResolvedModule } from '@modular-prompt/core';
import { distribute } from '@modular-prompt/core';
import type { ToolChoice, FinishReason, ToolDefinition } from '@modular-prompt/driver';
import { Logger } from '@modular-prompt/utils';
import type { LogEntry } from '@modular-prompt/utils';
import { WorkflowExecutionError } from '../../types.js';
import type { AIDriver } from '../../types.js';
import type { QueryResult } from '@modular-prompt/driver';
import type { ToolSpec, ToolCallLog } from '../types.js';
import { isBuiltinTool } from './builtin-tools.js';
import { aggregateUsage, aggregateLogEntries } from '../../usage-utils.js';

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
      const result = await spec.handler(tc.arguments, {});
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
  /** Maximum retries on tool errors (default: 2) */
  maxRetries?: number;
  logger?: Logger;
}

export interface QueryWithToolsResult {
  content: string;
  toolCallLog: ToolCallLog[];
  /** External tool calls that the LLM requested (not executed) */
  pendingToolCalls?: ToolCall[];
  /** 全 query() 呼び出しの合計 usage（リトライ含む） */
  consumedUsage?: QueryResult['usage'];
  /** 最終クエリの usage */
  responseUsage?: QueryResult['usage'];
  finishReason?: FinishReason;
  /** 全クエリの logEntries をフラット化 */
  logEntries?: LogEntry[];
  /** 全クエリの errors をフラット化 */
  errors?: LogEntry[];
}

/**
 * Query the model and handle tool calls with error retry.
 *
 * Builtin tools (__ prefix) are executed internally.
 * External tool calls are returned as pending for the caller.
 *
 * On tool errors (builtin execution failure or invalid tool name),
 * the error is fed back to the model and the query is retried
 * up to maxRetries times.
 */
export async function queryWithTools(
  driver: AIDriver,
  resolved: ResolvedModule,
  builtinTools: ToolSpec[],
  options: QueryWithToolsOptions = {}
): Promise<QueryWithToolsResult> {
  const { externalToolDefs = [], maxRetries = 2, logger: qLogger = logger } = options;
  const allToolDefs = [
    ...builtinTools.map(t => t.definition),
    ...externalToolDefs,
  ];
  const validExternalNames = new Set(externalToolDefs.map(d => d.name));

  const toolCallLog: ToolCallLog[] = [];
  const prompt = distribute(resolved);
  const queryOptions = {
    tools: allToolDefs.length > 0 ? allToolDefs : undefined,
    toolChoice: options.toolChoice ?? 'auto' as ToolChoice,
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
  };

  let retryCount = 0;
  const allUsages: (QueryResult['usage'] | undefined)[] = [];
  const allLogEntries: (LogEntry[] | undefined)[] = [];
  const allErrors: (LogEntry[] | undefined)[] = [];

  const buildResult = (content: string, lastResult: QueryResult, extra?: Partial<QueryWithToolsResult>): QueryWithToolsResult => {
    allUsages.push(lastResult.usage);
    allLogEntries.push(lastResult.logEntries);
    allErrors.push(lastResult.errors);
    return {
      content,
      toolCallLog,
      consumedUsage: aggregateUsage(allUsages),
      responseUsage: lastResult.usage,
      finishReason: lastResult.finishReason,
      logEntries: aggregateLogEntries(allLogEntries),
      errors: aggregateLogEntries(allErrors),
      ...extra,
    };
  };

  while (true) {
    const queryResult = await driver.query(prompt, queryOptions);
    qLogger.verbose('[output]', queryResult.content);

    const content = queryResult.content || '';

    // No tool calls → return
    if (!queryResult.toolCalls || queryResult.toolCalls.length === 0) {
      return buildResult(content, queryResult);
    }

    // Log tool calls
    for (const tc of queryResult.toolCalls) {
      qLogger.info('[tool:call]', tc.name, JSON.stringify(tc.arguments));
    }

    // Partition: builtin / valid external / invalid
    const builtinCalls = queryResult.toolCalls.filter(tc => isBuiltinTool(tc.name));
    const externalCalls = queryResult.toolCalls.filter(tc => !isBuiltinTool(tc.name));
    const validExternalCalls = externalCalls.filter(tc => validExternalNames.has(tc.name));
    const invalidCalls = externalCalls.filter(tc => !validExternalNames.has(tc.name));

    // Execute builtin tools
    const builtinResults: ToolResultMessageElement[] = builtinCalls.length > 0
      ? await executeBuiltinToolCalls(builtinCalls, builtinTools, qLogger)
      : [];

    // Record successful builtin results
    for (let j = 0; j < builtinCalls.length; j++) {
      toolCallLog.push({
        name: builtinCalls[j].name,
        arguments: builtinCalls[j].arguments,
        result: builtinResults[j].value,
      });
    }

    // Generate error results for invalid tool names
    const invalidResults: ToolResultMessageElement[] = invalidCalls.map(tc => ({
      type: 'message' as const, role: 'tool' as const, toolCallId: tc.id, name: tc.name,
      kind: 'error' as const,
      value: `Unknown tool: "${tc.name}". Available tools: ${allToolDefs.map(d => d.name).join(', ')}`,
    }));

    // Check for errors
    const hasBuiltinErrors = builtinResults.some(r => r.kind === 'error');
    const hasInvalidCalls = invalidCalls.length > 0;
    const hasErrors = hasBuiltinErrors || hasInvalidCalls;

    // No errors: return normally
    if (!hasErrors) {
      if (validExternalCalls.length > 0) {
        return buildResult(content, queryResult, { pendingToolCalls: validExternalCalls });
      }
      return buildResult(content, queryResult);
    }

    // Errors exist but no retries left → return what we have
    if (retryCount >= maxRetries) {
      qLogger.info('[retry:exhausted]', `gave up after ${maxRetries} retries`);
      if (validExternalCalls.length > 0) {
        return buildResult(content, queryResult, { pendingToolCalls: validExternalCalls });
      }
      return buildResult(content, queryResult);
    }

    // Accumulate intermediate usage/logEntries before retry
    allUsages.push(queryResult.usage);
    allLogEntries.push(queryResult.logEntries);
    allErrors.push(queryResult.errors);

    // Retry: append assistant message + tool results to prompt.output
    retryCount++;
    qLogger.info('[retry]', `attempt ${retryCount}/${maxRetries} due to tool errors`);

    const assistantMessage: StandardMessageElement = {
      type: 'message', role: 'assistant', content: content,
      toolCalls: queryResult.toolCalls,
    };
    const allToolResults = [...builtinResults, ...invalidResults];

    prompt.output.push(assistantMessage, ...allToolResults);

    // After first query, switch toolChoice to auto for retries
    queryOptions.toolChoice = 'auto';
  }
}

export function rethrowAsWorkflowError(
  error: unknown,
  context: unknown,
  details: Record<string, unknown>
): never {
  if (error instanceof WorkflowExecutionError) throw error;
  throw new WorkflowExecutionError(error as Error, context, details);
}
