import { compile, merge } from '@modular-prompt/core';
import type { PromptModule, CompiledPrompt } from '@modular-prompt/core';
import { WorkflowExecutionError } from '../types.js';
import type { AIDriver, WorkflowResult } from '../types.js';
import type {
  SelfPromptingWorkflowContext,
  SelfPromptingWorkflowOptions,
  SelfPromptingPlan,
  SelfPromptingStep,
  SelfPromptingExecutionLog,
  ActionHandler
} from './types.js';
import { planning } from './modules/planning.js';
import { integration } from './modules/integration.js';
import { type DriverInput, resolveDriver } from '../driver-input.js';

/**
 * Base module for self-prompting workflow
 */
const baseSelfPromptingModule: PromptModule<SelfPromptingWorkflowContext> = {
  methodology: [
    '- Self-prompting workflow executes work through Planning → Execution → Integration.',
    '- Planning generates complete prompts (instructions + data) for each step.',
    '- Execution uses generated prompts directly without further compilation.'
  ],
  state: [
    (ctx) => ctx.phase ? `Current phase: ${ctx.phase}` : null
  ]
};

/**
 * Execute planning phase to generate execution plan with complete prompts
 */
async function executePlanningPhase(
  driver: AIDriver,
  module: PromptModule<SelfPromptingWorkflowContext>,
  context: SelfPromptingWorkflowContext,
  maxSteps: number,
  logger?: any
): Promise<SelfPromptingPlan> {
  const planningPrompt = compile(merge(baseSelfPromptingModule, planning, module), context);

  try {
    const planResult = await driver.query(planningPrompt);

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

    let plan: SelfPromptingPlan;
    const rawOutput = planResult.structuredOutput as any;

    // Debug: Log raw model output
    if (logger) {
      logger.info(`Raw planning output: ${JSON.stringify(rawOutput, null, 2)}`);
    }

    // Handle case where model returns a single step object instead of {steps: [...]}
    if ('id' in rawOutput && 'prompt' in rawOutput && !('steps' in rawOutput)) {
      if (logger) {
        logger.info('Model returned single step object, wrapping in array');
      }
      plan = { steps: [rawOutput as SelfPromptingStep] };
    } else {
      plan = rawOutput as SelfPromptingPlan;
    }

    if (!plan.steps || !Array.isArray(plan.steps)) {
      throw new WorkflowExecutionError(
        'Plan must contain steps array',
        context,
        {
          phase: 'planning',
          partialResult: JSON.stringify(plan, null, 2)
        }
      );
    }

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
 * Execute a single step using generated prompt
 */
async function executeStep(
  driver: AIDriver,
  module: PromptModule<SelfPromptingWorkflowContext>,
  context: SelfPromptingWorkflowContext,
  step: SelfPromptingStep,
  actions: Record<string, ActionHandler>
): Promise<SelfPromptingExecutionLog> {
  let actionResult: any;

  // TODO: Reconsider action handling in self-prompting workflow
  // In the current implementation, actions are executed before the prompt,
  // but this may not align with the self-prompting philosophy where the AI
  // generates complete prompts that should be self-contained.
  // Possible alternatives:
  // 1. Actions should be part of the generated prompt instructions
  // 2. Actions should be executed based on the step result (not before)
  // 3. Remove action support entirely for this workflow variant

  // Execute actions if specified
  if (step.actions) {
    for (const action of step.actions) {
      const handler = actions[action.tool];
      if (!handler) {
        throw new WorkflowExecutionError(
          `Action "${action.tool}" is not available`,
          context,
          { phase: 'execution' }
        );
      }

      try {
        actionResult = await handler(action.params ?? {}, context);
      } catch (error) {
        throw new WorkflowExecutionError(
          error as Error,
          context,
          {
            phase: 'execution',
            partialResult: `Action ${action.tool} failed`
          }
        );
      }
    }
  }

  // Use the generated prompt string directly
  // Create a minimal CompiledPrompt structure with just the prompt text
  // Add previous step results as materials for context
  const previousResults = context.executionLog || [];
  const materials = previousResults.map((log) => ({
    type: 'material' as const,
    id: `previous-step-${log.stepId}`,
    title: `Result from ${log.stepId}`,
    content: log.result
  }));

  const executionPrompt: CompiledPrompt = {
    instructions: [{
      type: 'text',
      content: step.prompt
    }],
    data: materials,
    output: []
  };

  try {
    const result = await driver.query(executionPrompt);

    if (result.finishReason && result.finishReason !== 'stop') {
      throw new WorkflowExecutionError(
        `Execution failed with reason: ${result.finishReason}`,
        context,
        {
          phase: 'execution',
          partialResult: result.content,
          finishReason: result.finishReason
        }
      );
    }

    // Freeform output - use content directly
    return {
      stepId: step.id,
      result: result.content,
      actionResult,
      metadata: {
        usage: result.usage
      }
    };
  } catch (error) {
    if (error instanceof WorkflowExecutionError) {
      throw error;
    }
    throw new WorkflowExecutionError(error as Error, context, {
      phase: 'execution'
    });
  }
}

/**
 * Execute all steps in the execution plan
 */
async function executeExecutionPhase(
  driver: AIDriver,
  module: PromptModule<SelfPromptingWorkflowContext>,
  context: SelfPromptingWorkflowContext,
  plan: SelfPromptingPlan,
  actions: Record<string, ActionHandler>
): Promise<SelfPromptingExecutionLog[]> {
  const executionLog = context.executionLog ? [...context.executionLog] : [];
  const startIndex = executionLog.length;

  for (let i = startIndex; i < plan.steps.length; i++) {
    const currentStep = plan.steps[i];
    const logEntry = await executeStep(driver, module, context, currentStep, actions);
    executionLog.push(logEntry);
    context.executionLog = executionLog;
  }

  return executionLog;
}

/**
 * Execute integration phase to combine all results
 */
async function executeIntegrationPhase(
  driver: AIDriver,
  module: PromptModule<SelfPromptingWorkflowContext>,
  context: SelfPromptingWorkflowContext
): Promise<string> {
  const integrationPrompt = compile(merge(baseSelfPromptingModule, integration, module), context);

  try {
    const result = await driver.query(integrationPrompt);

    if (result.finishReason && result.finishReason !== 'stop') {
      throw new WorkflowExecutionError(
        `Integration failed with reason: ${result.finishReason}`,
        context,
        {
          phase: 'integration',
          partialResult: result.content,
          finishReason: result.finishReason
        }
      );
    }

    return result.content;
  } catch (error) {
    if (error instanceof WorkflowExecutionError) {
      throw error;
    }

    throw new WorkflowExecutionError(error as Error, context, {
      phase: 'integration'
    });
  }
}

/**
 * Self-prompting workflow - AI generates complete prompts for each step
 *
 * @param driver - AI driver for executing prompts
 * @param module - User's prompt module (merged with phase modules internally)
 * @param context - Workflow context
 * @param options - Workflow options
 * @returns Workflow result with final output and updated context
 */
export async function selfPromptingProcess(
  driver: DriverInput,
  module: PromptModule<SelfPromptingWorkflowContext>,
  context: SelfPromptingWorkflowContext,
  options: SelfPromptingWorkflowOptions = {}
): Promise<WorkflowResult<SelfPromptingWorkflowContext>> {
  const {
    maxSteps = 5,
    actions = {},
    enablePlanning = true,
    logger
  } = options;

  let currentContext: SelfPromptingWorkflowContext = { ...context };
  let plan: SelfPromptingPlan | undefined = currentContext.plan;

  // Planning phase
  if (enablePlanning || !plan) {
    if (logger) {
      logger.info('Starting planning phase');
    }
    currentContext.phase = 'planning';
    plan = await executePlanningPhase(resolveDriver(driver, 'plan'), module, currentContext, maxSteps, logger);
    currentContext.plan = plan;
    if (logger) {
      logger.info(`Planning completed: ${plan.steps.length} steps`);
    }
  }

  if (!plan) {
    throw new WorkflowExecutionError(
      'Self-prompting workflow requires a plan to execute',
      currentContext,
      { phase: 'planning' }
    );
  }

  // Execution phase
  if (logger) {
    logger.info('Starting execution phase');
  }
  currentContext.phase = 'execution';
  const executionLog = await executeExecutionPhase(resolveDriver(driver, 'instruct'), module, currentContext, plan, actions);
  currentContext.executionLog = executionLog;
  if (logger) {
    logger.info(`Execution completed: ${executionLog.length} steps`);
  }

  // Integration phase
  if (logger) {
    logger.info('Starting integration phase');
  }
  currentContext.phase = 'integration';
  const finalOutput = await executeIntegrationPhase(resolveDriver(driver, 'default'), module, currentContext);
  if (logger) {
    logger.info('Integration completed');
  }

  const finalContext: SelfPromptingWorkflowContext = {
    ...currentContext,
    phase: 'complete'
  };

  return {
    output: finalOutput,
    context: finalContext,
    metadata: {
      planSteps: plan.steps.length,
      executedSteps: executionLog.length,
      actionsUsed: executionLog.filter(log => log.actionResult !== undefined).length
    }
  };
}
