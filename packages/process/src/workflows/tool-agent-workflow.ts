/**
 * Tool agent workflow
 *
 * A simple agent loop: query the model with tools, execute tool calls,
 * feed results back, and repeat until the model produces a final output
 * or the turn limit is reached.
 *
 * All tools are executed internally — there is no builtin/external distinction.
 */

import { compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { ToolResultMessageElement, StandardMessageElement } from '@modular-prompt/core';
import type { ToolChoice, QueryResult } from '@modular-prompt/driver';
import { Logger } from '@modular-prompt/utils';
import type { LogEntry } from '@modular-prompt/utils';
import { WorkflowExecutionError, type WorkflowResult, type ToolSpec, type ToolCallLog, type ToolAgentContext } from './types.js';
import { type DriverInput, type ModelRole, resolveDriver } from './driver-input.js';
import { aggregateUsage, aggregateLogEntries } from './usage-utils.js';

const logger = new Logger({ prefix: 'process', context: 'tool-agent' });

/**
 * Options for tool agent workflow
 */
export interface ToolAgentOptions {
  /** Tools available to the agent (definition + handler) */
  tools?: ToolSpec[];
  /** Maximum number of query-execute turns (default: 10) */
  maxTurns?: number;
  /** Maximum output tokens per query */
  maxTokens?: number;
  /** Tool usage strategy */
  toolChoice?: ToolChoice;
  /** Driver role to use from DriverSet (default: 'default') */
  driverRole?: ModelRole;
}

/**
 * Tool agent workflow — runs a model with tools in a loop.
 *
 * The model is queried with tool definitions. When it produces tool calls,
 * they are executed and the results are fed back. This continues until
 * the model produces output without tool calls or maxTurns is reached.
 */
export async function toolAgentProcess<TContext extends ToolAgentContext & Record<string, any>>(
  driver: DriverInput,
  module: PromptModule<TContext>,
  context: TContext,
  options: ToolAgentOptions = {}
): Promise<WorkflowResult<TContext>> {
  const {
    tools = [],
    maxTurns = 10,
    driverRole = 'default',
  } = options;

  const resolvedDriver = resolveDriver(driver, driverRole);
  const toolDefs = tools.map(t => t.definition);
  const toolMap = new Map(tools.map(t => [t.definition.name, t]));

  // 会話履歴を context に蓄積する（未定義なら初期化）
  if (!context.messages) {
    context.messages = [];
  }

  try {
    logger.info('[start] tool-agent workflow');
    const queryOptions = {
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      toolChoice: options.toolChoice ?? 'auto' as ToolChoice,
      ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
    };

    const toolCallLog: ToolCallLog[] = [];
    const allUsages: (QueryResult['usage'] | undefined)[] = [];
    const allLogEntries: (LogEntry[] | undefined)[] = [];
    const allErrors: (LogEntry[] | undefined)[] = [];
    let turn = 0;

    while (turn < maxTurns) {
      turn++;
      logger.info(`[turn ${turn}/${maxTurns}]`);

      // 毎ターン re-compile: context の変化が prompt に反映される
      const prompt = compile(module, context);
      // context.messages を prompt.output に展開
      prompt.output.push(...context.messages);

      const result = await resolvedDriver.query(prompt, queryOptions);
      const content = result.content || '';
      logger.verbose('[output]', content);

      // No tool calls → done
      if (!result.toolCalls || result.toolCalls.length === 0) {
        allUsages.push(result.usage);
        allLogEntries.push(result.logEntries);
        allErrors.push(result.errors);

        logger.info(`[end] ${turn} turn(s)`);
        return {
          output: content,
          context,
          consumedUsage: aggregateUsage(allUsages),
          responseUsage: result.usage,
          logEntries: aggregateLogEntries(allLogEntries),
          errors: aggregateLogEntries(allErrors),
          metadata: {
            iterations: turn,
            toolCallLog,
            finishReason: result.finishReason,
          },
        };
      }

      // Execute tool calls
      for (const tc of result.toolCalls) {
        logger.info('[tool:call]', tc.name, JSON.stringify(tc.arguments));
      }

      const toolResults: ToolResultMessageElement[] = [];
      for (const tc of result.toolCalls) {
        const spec = toolMap.get(tc.name);
        if (!spec) {
          const errValue = `Unknown tool: "${tc.name}". Available tools: ${toolDefs.map(d => d.name).join(', ')}`;
          logger.warn('[tool:error]', tc.name, errValue);
          toolResults.push({
            type: 'message', role: 'tool', toolCallId: tc.id, name: tc.name,
            kind: 'error', value: errValue,
          });
          toolCallLog.push({ name: tc.name, arguments: tc.arguments, result: `Error: unknown tool` });
          continue;
        }
        try {
          const toolResult = await spec.handler(tc.arguments, context);
          logger.info('[tool:result]', tc.name, toolResult);
          toolResults.push({
            type: 'message', role: 'tool', toolCallId: tc.id, name: tc.name,
            kind: typeof toolResult === 'string' ? 'text' : 'data', value: toolResult,
          });
          toolCallLog.push({ name: tc.name, arguments: tc.arguments, result: toolResult });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.warn('[tool:error]', tc.name, errorMsg);
          toolResults.push({
            type: 'message', role: 'tool', toolCallId: tc.id, name: tc.name,
            kind: 'error', value: errorMsg,
          });
          toolCallLog.push({ name: tc.name, arguments: tc.arguments, result: `Error: ${errorMsg}` });
        }
      }

      // Accumulate usage from this turn
      allUsages.push(result.usage);
      allLogEntries.push(result.logEntries);
      allErrors.push(result.errors);

      // 会話履歴を context に蓄積（次の compile で反映される）
      const assistantMessage: StandardMessageElement = {
        type: 'message', role: 'assistant', content,
        toolCalls: result.toolCalls,
      };
      context.messages.push(assistantMessage, ...toolResults);

      // After first turn, ensure toolChoice is auto
      queryOptions.toolChoice = 'auto';
    }

    // maxTurns exhausted — return last content
    logger.info(`[end] max turns (${maxTurns}) reached`);
    return {
      output: '',
      context,
      consumedUsage: aggregateUsage(allUsages),
      logEntries: aggregateLogEntries(allLogEntries),
      errors: aggregateLogEntries(allErrors),
      metadata: {
        iterations: turn,
        toolCallLog,
      },
    };
  } catch (error) {
    throw new WorkflowExecutionError(
      error instanceof Error ? error : new Error(String(error)),
      context,
      { phase: 'tool-agent-loop' }
    );
  }
}
