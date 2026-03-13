/**
 * Agentic workflow - main flow control
 */

import type { PromptModule } from '@modular-prompt/core';
import type { WorkflowResult } from '../types.js';
import type { AgenticWorkflowContext, AgenticWorkflowOptions, AgenticTaskPlan } from './types.js';
import { type DriverInput, resolveDriver } from '../driver-input.js';
import { runPlanning } from './phases/planning.js';
import { runTask } from './phases/execution.js';
import { runIntegration } from './phases/integration.js';

// ---------------------------------------------------------------------------
// Module distribution
// ---------------------------------------------------------------------------

/**
 * Distribute user module sections to the appropriate phase.
 * Not all sections are relevant to every phase.
 */
export function distributeModule<T extends AgenticWorkflowContext>(
  userModule: PromptModule<T>,
  phase: 'planning' | 'execution' | 'integration'
): PromptModule<T> {
  switch (phase) {
    case 'planning':
      return {
        objective: userModule.objective,
        instructions: userModule.instructions,
        materials: userModule.materials,
        terms: userModule.terms,
        guidelines: userModule.guidelines,
      };
    case 'execution':
      return {
        objective: userModule.objective,
        terms: userModule.terms,
        // instructions are replaced by task guidelines/constraints
      };
    case 'integration':
      return {
        objective: userModule.objective,
        terms: userModule.terms,
        cue: userModule.cue,
        schema: userModule.schema,
      };
  }
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

/**
 * Agentic workflow - autonomous multi-step processing with task-based tool calling
 *
 * Flow:
 * 1. Planning: Decompose objective into tasks via __task tool
 * 2. Execution: Run each task sequentially, maintaining process state
 * 3. Integration: Combine results into formatted output
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

  // Process state — tracks progress across phases
  const processState = {
    plan: context.plan as AgenticTaskPlan | undefined,
    executionLog: context.executionLog || [],
    state: context.state,
    phase: 'planning' as AgenticWorkflowContext['phase'],
  };

  // Phase 1: Planning
  if (enablePlanning && !processState.plan) {
    processState.phase = 'planning';
    const distributed = distributeModule(module, 'planning');
    processState.plan = await runPlanning(
      resolveDriver(driver, 'plan'), distributed,
      { ...context, phase: 'planning' },
      maxTasks, maxToolCalls, logger
    );
  }

  const plan = processState.plan!;

  // Phase 2: Execution
  processState.phase = 'execution';
  const startIndex = processState.executionLog.length;

  for (let i = startIndex; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    const currentContext: AgenticWorkflowContext = {
      ...context,
      plan,
      executionLog: processState.executionLog,
      state: processState.state,
      phase: 'execution',
    };

    const distributed = distributeModule(module, 'execution');
    const logEntry = await runTask(
      resolveDriver(driver, 'instruct'), distributed, currentContext,
      task, tools, processState.executionLog,
      useFreeformExecution, maxToolCalls, logger
    );
    processState.executionLog.push(logEntry);

    if (logEntry.state !== undefined) {
      processState.state = {
        content: logEntry.state,
        usage: logEntry.metadata?.usage?.totalTokens
      };
    }
  }

  // Phase 3: Integration
  processState.phase = 'integration';
  const integrationContext: AgenticWorkflowContext = {
    ...context,
    plan,
    executionLog: processState.executionLog,
    state: processState.state,
    phase: 'integration',
  };

  const distributed = distributeModule(module, 'integration');
  const finalOutput = await runIntegration(
    resolveDriver(driver, 'default'), distributed, integrationContext, logger
  );

  // Build result
  const totalToolCalls = processState.executionLog.reduce(
    (sum, log) => sum + (log.toolCalls?.length || 0), 0
  );

  return {
    output: finalOutput,
    context: {
      ...context,
      plan,
      executionLog: processState.executionLog,
      state: processState.state,
      phase: 'complete'
    },
    metadata: {
      planTasks: plan.tasks.length,
      executedTasks: processState.executionLog.length,
      toolCallsUsed: totalToolCalls
    }
  };
}
