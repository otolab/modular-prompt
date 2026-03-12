import { compile, merge } from '@modular-prompt/core';
import type { PromptModule, ToolCall, ToolResultMessageElement, StandardMessageElement, CompiledPrompt } from '@modular-prompt/core';
import type { QueryResult } from '@modular-prompt/driver';
import { WorkflowExecutionError } from '../types.js';
import type { AIDriver, WorkflowResult } from '../types.js';
import type { AgenticWorkflowContext, AgenticWorkflowOptions, AgenticPlan, AgenticExecutionLog, ToolSpec, ToolCallLog } from './types.js';
import { agentic } from './modules/agentic.js';
import { planning } from './modules/planning.js';
import { execution } from './modules/execution.js';
import { executionFreeform } from './modules/execution-freeform.js';
import { integration } from './modules/integration.js';
import { type DriverInput, resolveDriver } from '../driver-input.js';

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
 * Execute planning phase
 */
async function executePlanningPhase(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  maxSteps: number,
  logger?: any
): Promise<AgenticPlan> {
  const planningModule = merge(agentic, planning, module);
  const prompt = compile(planningModule, context);

  try {
    const planResult = await driver.query(prompt);

    logger?.debug('Planning phase - AI generated:', planResult.content);

    // Check finish reason
    if (planResult.finishReason && planResult.finishReason !== 'stop') {
      throw new WorkflowExecutionError(
        `Planning failed with reason: ${planResult.finishReason}`,
        context,
        {
          phase: 'planning',
          finishReason: planResult.finishReason
        }
      );
    }

    // Get plan from structured output
    if (!planResult.structuredOutput) {
      throw new WorkflowExecutionError(
        'Planning did not return structured output',
        context,
        {
          phase: 'planning',
          partialResult: planResult.content
        }
      );
    }

    const plan = planResult.structuredOutput as AgenticPlan;

    // Validate and limit steps
    if (!plan.steps || !Array.isArray(plan.steps)) {
      throw new WorkflowExecutionError(
        'Invalid plan structure: steps is not an array',
        context,
        {
          phase: 'planning',
          partialResult: JSON.stringify(planResult.structuredOutput)
        }
      );
    }

    // Limit number of steps
    if (plan.steps.length > maxSteps) {
      plan.steps = plan.steps.slice(0, maxSteps);
    }

    return plan;

  } catch (error) {
    if (error instanceof WorkflowExecutionError) {
      throw error;
    }
    throw new WorkflowExecutionError(error as Error, context, {
      phase: 'planning'
    });
  }
}

/**
 * Execute a single step with tool calling loop
 */
async function executeStep(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  step: AgenticPlan['steps'][number],
  tools: ToolSpec[],
  executionLog: AgenticExecutionLog[],
  useFreeform: boolean,
  maxToolCalls: number,
  logger?: any
): Promise<AgenticExecutionLog> {
  // Select execution module
  const executionPhaseModule = useFreeform ? executionFreeform : execution;

  // For freeform mode, omit user's instructions to use plan-based guidelines/constraints instead
  const userModule = useFreeform
    ? { ...module, instructions: undefined }
    : module;

  const executionModule = merge(agentic, executionPhaseModule, userModule);
  const stepContext: AgenticWorkflowContext = {
    ...context,
    currentStep: step,
    executionLog
  };

  const originalPrompt = compile(executionModule, stepContext);

  // Tool calling loop
  const toolDefs = tools.map(t => t.definition);
  let prompt: CompiledPrompt = originalPrompt;
  const toolConversation: (StandardMessageElement | ToolResultMessageElement)[] = [];
  const toolCallHistory: ToolCallLog[] = [];
  let queryResult: QueryResult;
  let toolCallCount = 0;

  try {
    do {
      queryResult = await driver.query(prompt, {
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        toolChoice: toolDefs.length > 0 ? 'auto' : undefined,
      });

      logger?.debug(`Execution step ${step.id} - AI generated:`, queryResult.content);

      if (queryResult.toolCalls && queryResult.toolCalls.length > 0 && toolCallCount < maxToolCalls) {
        toolCallCount++;
        logger?.debug(`Step ${step.id} - Tool calls (round ${toolCallCount}):`, queryResult.toolCalls.map(tc => tc.name));

        const toolResults = await executeToolCalls(queryResult.toolCalls, tools);

        // Record history
        for (let i = 0; i < queryResult.toolCalls.length; i++) {
          toolCallHistory.push({
            name: queryResult.toolCalls[i].name,
            arguments: queryResult.toolCalls[i].arguments,
            result: toolResults[i].value,
          });
        }

        // Build conversation messages
        toolConversation.push(
          {
            type: 'message',
            role: 'assistant',
            content: queryResult.content || '',
            toolCalls: queryResult.toolCalls,
          } as StandardMessageElement,
          ...toolResults
        );

        // Rebuild prompt: tool messages go BEFORE text elements in output
        // Drivers extract MessageElements during iteration, accumulate text for the end
        // → messages come before cue/schema text
        prompt = {
          ...originalPrompt,
          output: [...toolConversation as any[], ...(originalPrompt.output || [])],
        };
      } else {
        break;
      }
    } while (true);

    // Check finish reason (only for non-tool_calls responses)
    if (queryResult.finishReason && queryResult.finishReason !== 'stop' && queryResult.finishReason !== 'tool_calls') {
      throw new WorkflowExecutionError(
        `Step execution failed with reason: ${queryResult.finishReason}`,
        stepContext,
        {
          phase: 'execution',
          partialResult: executionLog.map(log => log.result).join('\n\n'),
          finishReason: queryResult.finishReason
        }
      );
    }

    // Get reasoning, result and nextState from structured output
    let reasoning: string;
    let result: string;
    let nextState: string;

    if (queryResult.structuredOutput) {
      const output = queryResult.structuredOutput as { reasoning: string; result: string; nextState: string };
      reasoning = output.reasoning || '';
      result = output.result || queryResult.content;
      nextState = output.nextState || '';
    } else {
      // Fallback if structured output is not available
      reasoning = '';
      result = queryResult.content;
      nextState = '';
    }

    // Update context state with nextState for the next step
    context.state = {
      content: nextState,
      usage: queryResult.usage?.totalTokens
    };

    // Create execution log entry
    return {
      stepId: step.id,
      reasoning,
      result,
      toolCalls: toolCallHistory.length > 0 ? toolCallHistory : undefined,
      metadata: {
        usage: queryResult.usage,
        toolCallRounds: toolCallCount
      }
    };

  } catch (error) {
    if (error instanceof WorkflowExecutionError) {
      throw error;
    }
    throw new WorkflowExecutionError(error as Error, stepContext, {
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
  plan: AgenticPlan,
  tools: ToolSpec[],
  useFreeform: boolean,
  maxToolCalls: number,
  logger?: any
): Promise<AgenticExecutionLog[]> {
  const executionLog = context.executionLog || [];

  // Determine starting position (for resumption)
  const startIndex = executionLog.length;

  // Execute each step
  for (let i = startIndex; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const logEntry = await executeStep(driver, module, context, step, tools, executionLog, useFreeform, maxToolCalls, logger);
    executionLog.push(logEntry);
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
  executionLog: AgenticExecutionLog[],
  logger?: any
): Promise<string> {
  const integrationModule = merge(agentic, integration, module);
  const finalPrompt = compile(integrationModule, context);

  try {
    const integrationResult = await driver.query(finalPrompt);

    logger?.debug('Integration phase - AI generated:', integrationResult.content);

    // Check finish reason
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
    if (error instanceof WorkflowExecutionError) {
      throw error;
    }
    throw new WorkflowExecutionError(error as Error, context, {
      phase: 'integration',
      partialResult: executionLog.map(log => log.result).join('\n\n')
    });
  }
}

/**
 * Agentic workflow - autonomous multi-step processing with planning and tool calling
 *
 * Flow:
 * 1. Planning phase: Generate execution plan using structured outputs
 * 2. Execution phase: Execute each step (with tool calling loop)
 * 3. Integration phase: Integrate results and generate final output
 */
export async function agenticProcess(
  driver: DriverInput,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  options: AgenticWorkflowOptions = {}
): Promise<WorkflowResult<AgenticWorkflowContext>> {

  const {
    maxSteps = 5,
    tools = [],
    maxToolCalls = 10,
    enablePlanning = true,
    useFreeformExecution = false,
    logger
  } = options;

  let currentContext = { ...context };

  // Set available tools in context for planning/execution modules
  if (tools.length > 0) {
    currentContext.availableTools = tools.map(t => t.definition);
  }

  let plan: AgenticPlan;

  // Phase 1: Planning
  if (enablePlanning && !currentContext.plan) {
    currentContext.phase = 'planning';
    plan = await executePlanningPhase(resolveDriver(driver, 'plan'), module, currentContext, maxSteps, logger);
    currentContext.plan = plan;
  } else {
    // Use existing plan
    plan = currentContext.plan!;
  }

  // Phase 2: Execution
  currentContext.phase = 'execution';
  const executionLog = await executeExecutionPhase(resolveDriver(driver, 'instruct'), module, currentContext, plan, tools, useFreeformExecution, maxToolCalls, logger);
  currentContext.executionLog = executionLog;

  // Phase 3: Integration
  currentContext.phase = 'integration';
  const finalOutput = await executeIntegrationPhase(resolveDriver(driver, 'default'), module, currentContext, executionLog, logger);

  // Complete
  const finalContext: AgenticWorkflowContext = {
    ...currentContext,
    phase: 'complete'
  };

  // Count total tool calls across all steps
  const totalToolCalls = executionLog.reduce((sum, log) => sum + (log.toolCalls?.length || 0), 0);

  return {
    output: finalOutput,
    context: finalContext,
    metadata: {
      planSteps: plan.steps.length,
      executedSteps: executionLog.length,
      toolCallsUsed: totalToolCalls
    }
  };
}
