import { compile, merge } from '@modular-prompt/core';
import type { PromptModule, ToolCall, ToolResultMessageElement, StandardMessageElement, CompiledPrompt } from '@modular-prompt/core';
import type { QueryResult } from '@modular-prompt/driver';
import { WorkflowExecutionError } from '../types.js';
import type { AIDriver, WorkflowResult } from '../types.js';
import type { AgenticWorkflowContext, AgenticWorkflowOptions, AgenticTaskPlan, AgenticTask, AgenticTaskExecutionLog, ToolSpec, ToolCallLog } from './types.js';
import { createPlanningTools, createExecutionBuiltinTools, isBuiltinTool } from './builtin-tools.js';
import { agentic } from './modules/agentic.js';
import { planning } from './modules/planning.js';
import { execution } from './modules/execution.js';
import { executionFreeform } from './modules/execution-freeform.js';
import { integration } from './modules/integration.js';
import { type DriverInput, resolveDriver } from '../driver-input.js';

/**
 * Rethrow WorkflowExecutionError as-is, wrap other errors
 */
function rethrowAsWorkflowError(
  error: unknown,
  context: AgenticWorkflowContext,
  details: Record<string, unknown>
): never {
  if (error instanceof WorkflowExecutionError) {
    throw error;
  }
  throw new WorkflowExecutionError(error as Error, context, details);
}

/**
 * Execute tool calls and return ToolResultMessageElements
 */
async function executeToolCalls(
  toolCalls: ToolCall[],
  toolSpecs: ToolSpec[]
): Promise<ToolResultMessageElement[]> {
  const results: ToolResultMessageElement[] = [];
  for (const tc of toolCalls) {
    const spec = toolSpecs.find(s => s.definition.name === tc.name);
    if (!spec) {
      results.push({
        type: 'message',
        role: 'tool',
        toolCallId: tc.id,
        name: tc.name,
        kind: 'error',
        value: `Unknown tool: ${tc.name}`
      });
      continue;
    }
    try {
      const result = await spec.handler(tc.arguments);
      results.push({
        type: 'message',
        role: 'tool',
        toolCallId: tc.id,
        name: tc.name,
        kind: typeof result === 'string' ? 'text' : 'data',
        value: result
      });
    } catch (error) {
      results.push({
        type: 'message',
        role: 'tool',
        toolCallId: tc.id,
        name: tc.name,
        kind: 'error',
        value: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}

/**
 * Execute planning phase via __task tool calls
 */
async function executePlanningPhase(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  maxTasks: number,
  maxToolCalls: number,
  logger?: any
): Promise<AgenticTaskPlan> {
  const planningModule = merge(agentic, planning, module);
  const originalPrompt = compile(planningModule, context);

  // 組み込みツール（__task）を生成
  const registeredTasks: AgenticTask[] = [];
  const planningTools = createPlanningTools(registeredTasks);
  const toolDefs = planningTools.map(t => t.definition);

  let prompt: CompiledPrompt = originalPrompt;
  const toolConversation: (StandardMessageElement | ToolResultMessageElement)[] = [];

  try {
    for (let i = 0; i <= maxToolCalls; i++) {
      const queryResult = await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: i === 0 ? 'required' : 'auto',
      });

      logger?.debug('Planning phase - AI generated:', queryResult.content);

      if (!queryResult.toolCalls || queryResult.toolCalls.length === 0 || i === maxToolCalls) {
        break;
      }

      const toolResults = await executeToolCalls(queryResult.toolCalls, planningTools);

      toolConversation.push(
        {
          type: 'message',
          role: 'assistant',
          content: queryResult.content || '',
          toolCalls: queryResult.toolCalls,
        } as StandardMessageElement,
        ...toolResults
      );

      prompt = {
        ...originalPrompt,
        output: [...toolConversation as any[], ...(originalPrompt.output || [])],
      };
    }

    if (registeredTasks.length === 0) {
      throw new WorkflowExecutionError(
        'Planning phase did not register any tasks',
        context,
        { phase: 'planning' }
      );
    }

    // maxTasks で制限
    const tasks = registeredTasks.slice(0, maxTasks);
    return { tasks };

  } catch (error) {
    rethrowAsWorkflowError(error, context, { phase: 'planning' });
  }
}

/**
 * Execute a single task with tool calling loop
 */
async function executeTask(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  task: AgenticTask,
  externalTools: ToolSpec[],
  executionLog: AgenticTaskExecutionLog[],
  useFreeform: boolean,
  maxToolCalls: number,
  logger?: any
): Promise<AgenticTaskExecutionLog> {
  const executionPhaseModule = useFreeform ? executionFreeform : execution;
  const userModule = useFreeform
    ? { ...module, instructions: undefined }
    : module;

  const executionModule = merge(agentic, executionPhaseModule, userModule);
  const taskContext: AgenticWorkflowContext = {
    ...context,
    currentTask: task,
    executionLog
  };

  const originalPrompt = compile(executionModule, taskContext);

  // 組み込みツール + 外部ツール
  const stateRef = { current: undefined as string | undefined };
  const builtinTools = createExecutionBuiltinTools(stateRef);
  const allTools = [...externalTools, ...builtinTools];
  const allToolDefs = allTools.map(t => t.definition);

  let prompt: CompiledPrompt = originalPrompt;
  const toolConversation: (StandardMessageElement | ToolResultMessageElement)[] = [];
  const toolCallHistory: ToolCallLog[] = [];
  let queryResult!: QueryResult;
  let toolCallRounds = 0;
  let result = '';

  try {
    for (let i = 0; i <= maxToolCalls; i++) {
      queryResult = await driver.query(prompt, {
        tools: allToolDefs.length > 0 ? allToolDefs : undefined,
        toolChoice: allToolDefs.length > 0 ? 'auto' : undefined,
      });

      logger?.debug(`Execution task ${task.id} - AI generated:`, queryResult.content);

      // テキスト出力を result に蓄積
      if (queryResult.content) {
        result = queryResult.content;
      }

      if (!queryResult.toolCalls || queryResult.toolCalls.length === 0 || i === maxToolCalls) {
        break;
      }

      toolCallRounds++;
      logger?.debug(`Task ${task.id} - Tool calls (round ${toolCallRounds}):`, queryResult.toolCalls.map(tc => tc.name));

      const toolResults = await executeToolCalls(queryResult.toolCalls, allTools);

      // 外部ツールの呼び出しのみ履歴に記録
      for (let j = 0; j < queryResult.toolCalls.length; j++) {
        if (!isBuiltinTool(queryResult.toolCalls[j].name)) {
          toolCallHistory.push({
            name: queryResult.toolCalls[j].name,
            arguments: queryResult.toolCalls[j].arguments,
            result: toolResults[j].value,
          });
        }
      }

      toolConversation.push(
        {
          type: 'message',
          role: 'assistant',
          content: queryResult.content || '',
          toolCalls: queryResult.toolCalls,
        } as StandardMessageElement,
        ...toolResults
      );

      prompt = {
        ...originalPrompt,
        output: [...toolConversation as any[], ...(originalPrompt.output || [])],
      };
    }

    // finishReason チェック
    if (queryResult.finishReason && queryResult.finishReason !== 'stop' && queryResult.finishReason !== 'tool_calls') {
      throw new WorkflowExecutionError(
        `Task execution failed with reason: ${queryResult.finishReason}`,
        taskContext,
        {
          phase: 'execution',
          partialResult: executionLog.map(log => log.result).join('\n\n'),
          finishReason: queryResult.finishReason
        }
      );
    }

    return {
      taskId: task.id,
      taskType: task.taskType,
      result,
      toolCalls: toolCallHistory.length > 0 ? toolCallHistory : undefined,
      state: stateRef.current,
      metadata: {
        usage: queryResult.usage,
        toolCallRounds
      }
    };

  } catch (error) {
    rethrowAsWorkflowError(error, taskContext, {
      phase: 'execution',
      partialResult: executionLog.map(log => log.result).join('\n\n')
    });
  }
}

/**
 * Execute execution phase
 */
async function executeExecutionPhase(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  plan: AgenticTaskPlan,
  tools: ToolSpec[],
  useFreeform: boolean,
  maxToolCalls: number,
  logger?: any
): Promise<AgenticTaskExecutionLog[]> {
  const executionLog = context.executionLog || [];
  const startIndex = executionLog.length;

  for (let i = startIndex; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    const logEntry = await executeTask(driver, module, context, task, tools, executionLog, useFreeform, maxToolCalls, logger);
    executionLog.push(logEntry);

    // 状態を更新（次タスクに引き継ぐ）
    if (logEntry.state !== undefined) {
      context.state = {
        content: logEntry.state,
        usage: logEntry.metadata?.usage?.totalTokens
      };
    }
  }

  return executionLog;
}

/**
 * Execute integration phase
 */
async function executeIntegrationPhase(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  executionLog: AgenticTaskExecutionLog[],
  logger?: any
): Promise<string> {
  const integrationModule = merge(agentic, integration, module);
  const finalPrompt = compile(integrationModule, context);

  try {
    const integrationResult = await driver.query(finalPrompt);

    logger?.debug('Integration phase - AI generated:', integrationResult.content);

    if (integrationResult.finishReason && integrationResult.finishReason !== 'stop') {
      throw new WorkflowExecutionError(
        `Integration failed with reason: ${integrationResult.finishReason}`,
        context,
        {
          phase: 'integration',
          partialResult: executionLog.map(log => log.result).join('\n\n'),
          finishReason: integrationResult.finishReason
        }
      );
    }

    return integrationResult.content;

  } catch (error) {
    rethrowAsWorkflowError(error, context, {
      phase: 'integration',
      partialResult: executionLog.map(log => log.result).join('\n\n')
    });
  }
}

/**
 * Agentic workflow - autonomous multi-step processing with task-based tool calling
 *
 * Flow:
 * 1. Planning phase: Register tasks via __task tool calls
 * 2. Execution phase: Execute each task (text output = result, __updateState for state passing)
 * 3. Integration phase: Integrate results and generate final output
 */
export async function agenticProcess(
  driver: DriverInput,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  options: AgenticWorkflowOptions = {}
): Promise<WorkflowResult<AgenticWorkflowContext>> {

  const {
    maxTasks = 5,
    tools = [],
    maxToolCalls = 10,
    enablePlanning = true,
    useFreeformExecution = false,
    logger
  } = options;

  let currentContext = { ...context };

  let plan: AgenticTaskPlan;

  // Phase 1: Planning
  if (enablePlanning && !currentContext.plan) {
    currentContext.phase = 'planning';
    plan = await executePlanningPhase(resolveDriver(driver, 'plan'), module, currentContext, maxTasks, maxToolCalls, logger);
    currentContext.plan = plan;
  } else {
    plan = currentContext.plan!;
  }

  // Phase 2: Execution
  currentContext.phase = 'execution';
  const executionLog = await executeExecutionPhase(resolveDriver(driver, 'instruct'), module, currentContext, plan, tools, useFreeformExecution, maxToolCalls, logger);
  currentContext.executionLog = executionLog;

  // Phase 3: Integration
  currentContext.phase = 'integration';
  const finalOutput = await executeIntegrationPhase(resolveDriver(driver, 'default'), module, currentContext, executionLog, logger);

  const finalContext: AgenticWorkflowContext = {
    ...currentContext,
    phase: 'complete'
  };

  const totalToolCalls = executionLog.reduce((sum, log) => sum + (log.toolCalls?.length || 0), 0);

  return {
    output: finalOutput,
    context: finalContext,
    metadata: {
      planTasks: plan.tasks.length,
      executedTasks: executionLog.length,
      toolCallsUsed: totalToolCalls
    }
  };
}
