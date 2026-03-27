/**
 * Agentic workflow v2 - task sequence based processing
 *
 * Fixed phases are replaced by a task sequence.
 * Each task type has its own prompt construction and input contract.
 *
 * Flow:
 * 1. Bootstrap: Generate initial task list [planning, outputXxx]
 * 2. Task loop: Execute each task sequentially
 * 3. Output: Last task (outputMessage/outputStructured) result is the final output
 */

import { merge, resolve } from '@modular-prompt/core';
import type { PromptModule, ResolvedModule, ResolvedSectionContent } from '@modular-prompt/core';
import type { FinishReason } from '@modular-prompt/driver';
import { Logger } from '@modular-prompt/utils';
import type { WorkflowResult } from '../types.js';
import type {
  AgenticWorkflowContext,
  AgenticWorkflowOptions,
  AgenticResumeState,
  AgenticTask,
  AgenticTaskExecutionLog,
  TaskType,
  ToolSpec,
} from './types.js';
import { DEFAULT_DRIVER_ROLE } from './types.js';
import { type DriverInput, resolveDriver } from '../driver-input.js';
import { getTaskTypeConfig, taskCommon, MAX_TOKENS_VALUES } from './task-types/index.js';
import { replanningModule } from './task-types/planning.js';
import {
  createPlanningTools,
  createExecutionBuiltinTools,
  getBuiltinToolDefinitions,
} from './process/builtin-tools.js';
import { queryWithTools, rethrowAsWorkflowError } from './process/query-with-tools.js';

const logger = new Logger({ prefix: 'process', context: 'agentic' });

/**
 * Strip <think>...</think> blocks from model output.
 * Thinking traces are internal reasoning and should not be passed to subsequent tasks.
 */
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/^[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * Check if the resolved user module's messages end with a tool result.
 * This indicates a re-planning scenario where a previous workflow broke
 * on an external tool call and the result is now available.
 */
function hasTrailingToolResult(userModule: ResolvedModule): boolean {
  const messages = userModule.messages as ResolvedSectionContent | undefined;
  if (!messages || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  return typeof last === 'object' && last !== null && 'role' in last && last.role === 'tool';
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Generate the initial task list based on the user module.
 * - Always starts with a planning task.
 * - Ends with outputStructured (if schema) or outputMessage.
 */
function bootstrap(module: ResolvedModule, enablePlanning: boolean): AgenticTask[] {
  const tasks: AgenticTask[] = [];

  if (enablePlanning) {
    tasks.push({
      instruction: 'Analyze the prompt and register tasks',
      taskType: 'planning',
    });
  } else {
    // No planning: default to a single output task
    tasks.push({
      instruction: 'Compose the response using the preceding task results.',
      taskType: 'output',
    });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

/**
 * Get builtin tools for a task based on its type config.
 */
function getBuiltinToolsForTask(
  taskType: TaskType,
  taskList: AgenticTask[],
  currentIndex: number,
  context: AgenticWorkflowContext
): ToolSpec[] {
  const config = getTaskTypeConfig(taskType);
  const toolNames = new Set(config.builtinToolNames);

  const allTools: ToolSpec[] = [];

  if (toolNames.has('__insert_tasks')) {
    allTools.push(...createPlanningTools(taskList, currentIndex));
  }

  if (toolNames.has('__time')) {
    // createExecutionBuiltinTools returns [__insert_tasks, __time]
    // We only want __time if __insert_tasks is not already added
    const execTools = createExecutionBuiltinTools(taskList, currentIndex);
    const timeOnly = execTools.filter(t => t.definition.name === '__time');
    allTools.push(...timeOnly);
  }

  return allTools;
}

/**
 * Execute a single task.
 */
async function executeTask(
  driver: DriverInput,
  userModule: ResolvedModule,
  context: AgenticWorkflowContext,
  task: AgenticTask,
  taskIndex: number,
  taskList: AgenticTask[],
  externalTools: ToolSpec[]
): Promise<AgenticTaskExecutionLog> {
  const taskLogger = logger.context(`agentic:task:${taskIndex + 1}:${task.taskType}`);
  taskLogger.info(`[start] (${task.taskType})`, task.instruction);

  const taskConfig = getTaskTypeConfig(task.taskType);

  // Build workflowBase from resolved userModule
  // output tasks get the full userModule; other tasks get objective/terms/state only
  const workflowBase: PromptModule<AgenticWorkflowContext> = task.taskType === 'output'
    ? { ...userModule } as PromptModule<AgenticWorkflowContext>
    : {
        objective: userModule.objective,
        terms: userModule.terms,
      };

  // Merge and resolve: planning has its own terms/methodology, others use taskCommon
  let resolved: ResolvedModule;
  if (task.taskType === 'planning') {
    const planningMerged = hasTrailingToolResult(userModule)
      ? merge(workflowBase, taskConfig.module, replanningModule)
      : merge(workflowBase, taskConfig.module);
    resolved = resolve(planningMerged, context);
  } else {
    resolved = resolve(merge(workflowBase, taskCommon, taskConfig.module), context);
  }

  const builtinTools = getBuiltinToolsForTask(task.taskType, taskList, taskIndex, context);
  const externalToolDefs = externalTools.map(t => t.definition);
  const allToolNames = [...builtinTools.map(t => t.definition.name), ...externalToolDefs.map(t => t.name)];
  taskLogger.verbose('[prompt]', JSON.stringify(resolved), allToolNames.length > 0 ? `tools: [${allToolNames.join(', ')}]` : '');

  const driverRole = task.driverRole || DEFAULT_DRIVER_ROLE[task.taskType];

  try {
    const maxTokens = MAX_TOKENS_VALUES[taskConfig.maxTokensTier];

    const result = await queryWithTools(
      resolveDriver(driver, driverRole),
      resolved,
      builtinTools,
      {
        externalToolDefs: externalToolDefs.length > 0 ? externalToolDefs : undefined,
        toolChoice: 'auto',
        maxTokens,
        logger: taskLogger,
      }
    );

    taskLogger.info('[end]');

    return {
      taskName: task.name,
      taskType: task.taskType,
      instruction: task.instruction,
      result: stripThinkBlocks(result.content),
      toolCallLog: result.toolCallLog.length > 0 ? result.toolCallLog : undefined,
      pendingToolCalls: result.pendingToolCalls,
      metadata: {
        usage: result.usage,
      },
    };
  } catch (error) {
    rethrowAsWorkflowError(error, context, {
      phase: task.taskType,
      partialResult: context.executionLog?.map(log => log.result).join('\n\n') || '',
    });
  }
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function agenticProcess<T>(
  driver: DriverInput,
  module: PromptModule<T>,
  context: T,
  options: AgenticWorkflowOptions = {}
): Promise<WorkflowResult<AgenticResumeState>> {
  logger.info('[start] agentic workflow');

  const {
    maxTasks = 10,
    tools = [],
    enablePlanning = true,
    includeThinking = false,
    resumeState,
  } = options;

  // Resolve user module: DynamicContent → static values
  const userModule = resolve(module, context);

  // Build internal context (mutable — shared across tasks)
  const internalContext: AgenticWorkflowContext = {
    userModule,
    taskList: resumeState?.taskList ?? bootstrap(userModule, enablePlanning),
    executionLog: resumeState?.executionLog ? [...resumeState.executionLog] : [],
    currentTaskIndex: 0,
    // planningがタスク設計時にツールの存在を把握し、適切なactタスクを計画できるようにする
    availableTools: [
      ...getBuiltinToolDefinitions(),
      ...tools.map(t => t.definition),
    ],
  };

  const { taskList, executionLog } = internalContext as Required<Pick<AgenticWorkflowContext, 'taskList' | 'executionLog'>>;
  const startIndex = executionLog.length;

  // Task loop
  for (let i = startIndex; i < taskList.length; i++) {
    // Guard: max tasks
    if (i >= maxTasks) {
      logger.info('[end] Max tasks reached', `(${maxTasks})`);
      break;
    }

    const task = taskList[i];
    internalContext.currentTaskIndex = i;

    const logEntry = await executeTask(
      driver, userModule, internalContext, task, i, taskList,
      tools
    );
    executionLog.push(logEntry);

    // Stop workflow if external tool calls are pending
    if (logEntry.pendingToolCalls && logEntry.pendingToolCalls.length > 0) {
      logger.info('[suspended] External tool call requested');
      break;
    }
  }

  // Check if workflow was suspended by external tool calls
  const lastExecuted = executionLog[executionLog.length - 1];
  const hasPendingToolCalls = lastExecuted?.pendingToolCalls && lastExecuted.pendingToolCalls.length > 0;

  // Auto-append output task if the last executed task was not output and no pending tool calls
  if (lastExecuted && lastExecuted.taskType !== 'output' && !hasPendingToolCalls) {
    const outputTask: AgenticTask = {
      instruction: 'Compose the response using the preceding task results.',
      taskType: 'output',
    };
    taskList.push(outputTask);
    const outputIndex = taskList.length - 1;
    internalContext.currentTaskIndex = outputIndex;

    const outputLog = await executeTask(
      driver, userModule, internalContext, outputTask, outputIndex, taskList,
      tools
    );
    executionLog.push(outputLog);
  }

  // Final output
  const lastLog = executionLog[executionLog.length - 1];
  const finalResult = lastLog?.result || '';

  let output: string;
  if (includeThinking && executionLog.length > 1) {
    const intermediateLog = executionLog.slice(0, -1);
    const thinkingLines = intermediateLog
      .map(log => `[${log.taskType}: ${log.instruction}]\n${log.result}`)
      .join('\n\n');
    output = `<think>\n${thinkingLines}\n</think>\n\n${finalResult}`;
  } else {
    output = finalResult;
  }

  const finishReason: FinishReason | undefined = hasPendingToolCalls
    ? 'tool_calls'
    : 'stop';

  const totalToolCalls = executionLog.reduce(
    (sum, log) => sum + (log.pendingToolCalls?.length || 0), 0
  );

  logger.info('[end] agentic workflow');

  return {
    output,
    context: {
      taskList,
      executionLog,
    },
    metadata: {
      planTasks: taskList.length,
      executedTasks: executionLog.length,
      toolCallsUsed: totalToolCalls,
      finishReason,
      usage: lastLog?.metadata?.usage,
    },
  };
}
