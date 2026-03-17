/**
 * Tool calling loop implementation
 */

import type { ToolCall, ToolResultMessageElement, StandardMessageElement, Element, ResolvedModule } from '@modular-prompt/core';
import { distribute } from '@modular-prompt/core';
import type { ToolChoice, FinishReason, ToolDefinition } from '@modular-prompt/driver';
import { Logger } from '@modular-prompt/utils';
import { WorkflowExecutionError } from '../../types.js';
import type { AIDriver } from '../../types.js';
import type { QueryResult } from '@modular-prompt/driver';
import type { ToolSpec, ToolCallLog, AgenticWorkflowContext } from '../types.js';
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
      logger.debug('[tool:result]', tc.name, result);
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
  maxIterations?: number;
  logPrefix?: string;
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
 * Run a query with tool calling loop.
 *
 * Only builtin tools (__ prefix) are executed internally.
 * External tool calls cause the loop to stop immediately and
 * return the pending calls for the caller to handle.
 */
export async function queryWithTools(
  driver: AIDriver,
  resolved: ResolvedModule,
  builtinTools: ToolSpec[],
  options: QueryWithToolsOptions = {}
): Promise<QueryWithToolsResult> {
  const { externalToolDefs = [], maxIterations = 10, logger: qLogger = logger } = options;
  const allToolDefs = [
    ...builtinTools.map(t => t.definition),
    ...externalToolDefs,
  ];

  const conversation: (StandardMessageElement | ToolResultMessageElement)[] = [];
  const toolCallLog: ToolCallLog[] = [];
  let content = '';
  let lastResult: { usage?: QueryWithToolsResult['usage']; finishReason?: FinishReason } = {};

  for (let i = 0; i <= maxIterations; i++) {
    // Distribute resolved module to CompiledPrompt, appending conversation history
    const prompt = distribute(
      conversation.length > 0
        ? { ...resolved, messages: [...(resolved.messages || []), ...conversation] }
        : resolved
    );
    const queryResult = await driver.query(prompt, {
      tools: allToolDefs.length > 0 ? allToolDefs : undefined,
      toolChoice: i === 0 ? (options.toolChoice ?? 'auto') : 'auto',
    });

    qLogger.verbose('[output]', queryResult.content);

    if (queryResult.content) {
      content = queryResult.content;
    }
    lastResult = { usage: queryResult.usage, finishReason: queryResult.finishReason };

    if (!queryResult.toolCalls || queryResult.toolCalls.length === 0 || i === maxIterations) {
      break;
    }

    // Partition tool calls into builtin and external
    const builtinCalls = queryResult.toolCalls.filter(tc => isBuiltinTool(tc.name));
    const externalCalls = queryResult.toolCalls.filter(tc => !isBuiltinTool(tc.name));

    // Log tool calls
    for (const tc of queryResult.toolCalls) {
      qLogger.debug('[tool:call]', tc.name, JSON.stringify(tc.arguments));
    }

    // Execute builtin tools
    if (builtinCalls.length > 0) {
      const toolResults = await executeBuiltinToolCalls(builtinCalls, builtinTools, qLogger);
      for (let j = 0; j < builtinCalls.length; j++) {
        toolCallLog.push({
          name: builtinCalls[j].name,
          arguments: builtinCalls[j].arguments,
          result: toolResults[j].value,
        });
      }

      conversation.push(
        {
          type: 'message', role: 'assistant',
          content: queryResult.content || '',
          toolCalls: builtinCalls,
        } as StandardMessageElement,
        ...toolResults
      );
    }

    // External tool calls → stop immediately and return them
    if (externalCalls.length > 0) {
      return {
        content, toolCallLog,
        pendingToolCalls: externalCalls,
        usage: lastResult.usage, finishReason: lastResult.finishReason
      };
    }

    // conversation is accumulated; next iteration will distribute with updated messages
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
