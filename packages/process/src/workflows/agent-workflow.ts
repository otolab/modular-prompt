import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { WorkflowExecutionError } from './types.js';
import type { AIDriver, WorkflowResult } from './types.js';
import { type DriverInput, resolveDriver } from './driver-input.js';

/**
 * Agent workflow plan step definition
 */
interface AgentWorkflowStep {
  id: string;
  description: string;
  action?: string;
  params?: any;
}

/**
 * Execution log entry
 */
interface AgentWorkflowExecutionLog {
  stepId: string;
  result: string;
  metadata?: Record<string, any>;
}

/**
 * Agent workflow plan structure
 */
interface AgentWorkflowPlan {
  steps: AgentWorkflowStep[];
}

/**
 * Action handler signature
 */
export type AgentWorkflowActionHandler = (params: any, context: AgentWorkflowContext) => Promise<any>;

/**
 * Agent workflow context stored between phases
 */
export interface AgentWorkflowContext {
  objective: string;
  inputs?: any;
  plan?: AgentWorkflowPlan;
  executionLog?: AgentWorkflowExecutionLog[];
  currentStep?: AgentWorkflowStep;
  actionResult?: any;
  phase?: 'planning' | 'execution' | 'integration' | 'complete';
}

/**
 * Options for agent workflow execution
 */
export interface AgentWorkflowOptions {
  maxSteps?: number;
  actions?: Record<string, AgentWorkflowActionHandler>;
  enablePlanning?: boolean;
}

const baseAgentModule: PromptModule<AgentWorkflowContext> = {
  methodology: [
    '- Simple agent workflow executes work through Planning → Execution → Integration.',
    '- Keep reasoning explicit and document what each phase accomplishes.'
  ],
  state: [
    (ctx) => ctx.phase ? `Current phase: ${ctx.phase}` : null
  ]
};

const planningModule: PromptModule<AgentWorkflowContext> = {
  methodology: [
    '- **Planning Phase**',
    '  - Break the objective into concrete executable steps.',
    '  - Use JSON output so the application can parse the plan.'
  ],
  instructions: [
    {
      type: 'subsection',
      title: 'Planning Requirements',
      items: [
        '- Produce 3-5 ordered steps that accomplish the objective.',
        '- Each step needs: id (e.g., "step-1"), description, optional action + params.',
        '- Consider available inputs when proposing the steps.',
        '- Output valid JSON only. No commentary or markdown fences.'
      ]
    }
  ],
  inputs: [
    (ctx) => ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null
  ],
  state: [
    'Phase: planning'
  ],
  cue: [
    'Return a JSON object that contains the plan. Respond only with JSON text.',
    'Start the response with { and end with }.'
  ],
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                description: { type: 'string' },
                action: { type: 'string' },
                params: { type: 'object' }
              },
              required: ['id', 'description']
            },
            minItems: 1
          }
        },
        required: ['steps']
      }
    }
  ]
};

const executionModule: PromptModule<AgentWorkflowContext> = {
  methodology: [
    '- **Execution Phase**',
    '- Complete only the current step from the plan and describe the result clearly.'
  ],
  instructions: [
    {
      type: 'subsection',
      title: 'Current Step',
      items: [
        (ctx) => ctx.currentStep
          ? `- Execute: ${ctx.currentStep.description}`
          : '- There is no current step.'
      ]
    },
    {
      type: 'subsection',
      title: 'Execution Plan Overview',
      items: [
        (ctx) => {
          if (!ctx.plan) {
            return '- Plan not available.';
          }

          const completed = ctx.executionLog?.length || 0;
          return ctx.plan.steps.map((step: AgentWorkflowStep, index: number) => {
            const prefix = index < completed
              ? '[done]'
              : (ctx.currentStep?.id === step.id ? '[current]' : '[todo]');
            const actionInfo = step.action ? ` (action: ${step.action})` : '';
            return `- ${prefix} ${step.id}: ${step.description}${actionInfo}`;
          });
        }
      ]
    }
  ],
  state: [
    (ctx) => {
      const completed = ctx.executionLog?.length || 0;
      const total = ctx.plan?.steps.length || 0;
      return `Progress: ${completed}/${total} steps completed`;
    }
  ],
  inputs: [
    (ctx) => ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null
  ],
  materials: [
    (ctx) => {
      if (ctx.actionResult === undefined) {
        return null;
      }

      return {
        type: 'material' as const,
        id: 'action-result',
        title: 'Latest action output',
        content: typeof ctx.actionResult === 'string'
          ? ctx.actionResult
          : JSON.stringify(ctx.actionResult, null, 2)
      };
    },
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0) {
        return null;
      }

      return ctx.executionLog.map((log) => ({
        type: 'material' as const,
        id: `execution-log-${log.stepId}`,
        title: `Previous result: ${log.stepId}`,
        content: log.result
      }));
    }
  ],
  cue: [
    'Describe the work performed for this step and the resulting findings.',
    'Only focus on the current step.'
  ]
};

const integrationModule: PromptModule<AgentWorkflowContext> = {
  methodology: [
    '- **Integration Phase**',
    '- Combine the outcomes from all steps and deliver the final answer.'
  ],
  instructions: [
    {
      type: 'subsection',
      title: 'Integration Goals',
      items: [
        '- Summarize the outcome of each executed step.',
        '- Confirm that the overall objective has been satisfied.',
        '- Present a cohesive final response.'
      ]
    }
  ],
  inputs: [
    (ctx) => ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null
  ],
  materials: [
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0) {
        return null;
      }

      return ctx.executionLog.map((log) => ({
        type: 'material' as const,
        id: `integrated-result-${log.stepId}`,
        title: `Result from ${log.stepId}`,
        content: log.result
      }));
    }
  ],
  state: [
    (ctx) => {
      const total = ctx.plan?.steps.length || 0;
      return `All ${total} steps complete. Generate the final answer.`;
    }
  ],
  cue: [
    'Integrate every step result and provide the final deliverable.'
  ]
};

async function executePlanningPhase(
  driver: AIDriver,
  module: PromptModule<AgentWorkflowContext>,
  context: AgentWorkflowContext,
  maxSteps: number
): Promise<AgentWorkflowPlan> {
  const planningPrompt = compile(merge(baseAgentModule, planningModule, module), context);

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

    const plan = planResult.structuredOutput as AgentWorkflowPlan;
    if (!plan.steps || !Array.isArray(plan.steps)) {
      throw new WorkflowExecutionError(
        'Plan must contain steps array',
        context,
        {
          phase: 'planning'
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

async function executeStep(
  driver: AIDriver,
  module: PromptModule<AgentWorkflowContext>,
  context: AgentWorkflowContext,
  step: AgentWorkflowStep,
  actions: Record<string, AgentWorkflowActionHandler>
): Promise<AgentWorkflowExecutionLog> {
  let actionResult: any;

  if (step.action) {
    const handler = actions[step.action];
    if (!handler) {
      throw new WorkflowExecutionError(
        `Action "${step.action}" is not available`,
        context,
        { phase: 'execution' }
      );
    }

    try {
      actionResult = await handler(step.params ?? {}, context);
    } catch (error) {
      throw new WorkflowExecutionError(
        (error as Error),
        context,
        {
          phase: 'execution',
          partialResult: `Action ${step.action} failed`
        }
      );
    }
  }

  const executionPrompt = compile(
    merge(baseAgentModule, executionModule, module),
    {
      ...context,
      currentStep: step,
      actionResult
    }
  );

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

    return {
      stepId: step.id,
      result: result.content,
      metadata: {
        usage: result.usage,
        action: step.action,
        actionResult
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

async function executeExecutionPhase(
  driver: AIDriver,
  module: PromptModule<AgentWorkflowContext>,
  context: AgentWorkflowContext,
  plan: AgentWorkflowPlan,
  actions: Record<string, AgentWorkflowActionHandler>
): Promise<AgentWorkflowExecutionLog[]> {
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

async function executeIntegrationPhase(
  driver: AIDriver,
  module: PromptModule<AgentWorkflowContext>,
  context: AgentWorkflowContext
): Promise<string> {
  const integrationPrompt = compile(merge(baseAgentModule, integrationModule, module), context);

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
 * Agent workflow - simple planning/execution/integration pipeline
 */
export async function agentProcess(
  driver: DriverInput,
  module: PromptModule<AgentWorkflowContext>,
  context: AgentWorkflowContext,
  options: AgentWorkflowOptions = {}
): Promise<WorkflowResult<AgentWorkflowContext>> {
  const {
    maxSteps = 5,
    actions = {},
    enablePlanning = true
  } = options;

  let currentContext: AgentWorkflowContext = { ...context };
  let plan: AgentWorkflowPlan | undefined = currentContext.plan;

  if (enablePlanning || !plan) {
    currentContext.phase = 'planning';
    plan = await executePlanningPhase(resolveDriver(driver, 'plan'), module, currentContext, maxSteps);
    currentContext.plan = plan;
  }

  if (!plan) {
    throw new WorkflowExecutionError(
      'Agent workflow requires a plan to execute',
      currentContext,
      { phase: 'planning' }
    );
  }

  currentContext.phase = 'execution';
  const executionLog = await executeExecutionPhase(resolveDriver(driver, 'instruct'), module, currentContext, plan, actions);
  currentContext.executionLog = executionLog;

  currentContext.phase = 'integration';
  const finalOutput = await executeIntegrationPhase(resolveDriver(driver, 'default'), module, currentContext);

  const finalContext: AgentWorkflowContext = {
    ...currentContext,
    phase: 'complete'
  };

  return {
    output: finalOutput,
    context: finalContext,
    metadata: {
      planSteps: plan.steps.length,
      executedSteps: executionLog.length,
      actionsUsed: executionLog.filter(log => log.metadata?.actionResult !== undefined).length
    }
  };
}
