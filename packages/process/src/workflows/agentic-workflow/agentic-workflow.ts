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

import { compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { FinishReason } from '@modular-prompt/driver';
import type { WorkflowResult } from '../types.js';
import type {
  AgenticWorkflowContext,
  AgenticWorkflowOptions,
  AgenticTask,
  AgenticTaskExecutionLog,
  TaskType,
  ToolSpec,
  AgenticLogger,
} from './types.js';
import { DEFAULT_DRIVER_ROLE } from './types.js';
import { type DriverInput, resolveDriver } from '../driver-input.js';
import { getTaskTypeConfig } from './task-types/index.js';
import {
  createPlanningTools,
  createExecutionBuiltinTools,
} from './process/builtin-tools.js';
import { queryWithTools, rethrowAsWorkflowError } from './process/query-with-tools.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Generate the initial task list based on the user module.
 * - Always starts with a planning task.
 * - Ends with outputStructured (if schema) or outputMessage.
 */
function bootstrap(module: PromptModule<AgenticWorkflowContext>): AgenticTask[] {
  const tasks: AgenticTask[] = [];

  tasks.push({
    id: 1,
    description: 'Decompose objective into executable tasks',
    taskType: 'planning',
  });

  const outputType: TaskType = module.schema ? 'outputStructured' : 'outputMessage';
  tasks.push({
    id: 2,
    description: 'Generate the final output based on all task results',
    taskType: outputType,
  });

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
  taskList: AgenticTask[]
): ToolSpec[] {
  const config = getTaskTypeConfig(taskType);
  const toolNames = new Set(config.builtinToolNames);

  const allTools: ToolSpec[] = [];

  if (toolNames.has('__task')) {
    allTools.push(...createPlanningTools(taskList));
  }

  if (toolNames.has('__time')) {
    // createExecutionBuiltinTools returns [__task, __time]
    // We only want __time if __task is not already added
    const execTools = createExecutionBuiltinTools(taskList);
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
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  task: AgenticTask,
  taskList: AgenticTask[],
  externalTools: ToolSpec[],
  maxToolCalls: number,
  logger?: AgenticLogger
): Promise<AgenticTaskExecutionLog> {
  const taskConfig = getTaskTypeConfig(task.taskType);
  const taskModule = taskConfig.buildModule(task, context, module);
  const prompt = compile(taskModule, context);

  const builtinTools = getBuiltinToolsForTask(task.taskType, taskList);
  const externalToolDefs = externalTools.map(t => t.definition);

  const driverRole = task.driverRole || DEFAULT_DRIVER_ROLE[task.taskType];

  try {
    const toolChoice = task.taskType === 'planning' ? 'required' as const : 'auto' as const;

    const result = await queryWithTools(
      resolveDriver(driver, driverRole),
      prompt,
      builtinTools,
      {
        externalToolDefs: externalToolDefs.length > 0 ? externalToolDefs : undefined,
        toolChoice,
        maxIterations: maxToolCalls,
        logger,
        logPrefix: `Task ${task.id} (${task.taskType}) - `,
      }
    );

    return {
      taskId: task.id,
      taskType: task.taskType,
      result: result.content,
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

export async function agenticProcess(
  driver: DriverInput,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  options: AgenticWorkflowOptions = {}
): Promise<WorkflowResult<AgenticWorkflowContext>> {
  const {
    maxTasks = 10,
    tools = [],
    maxToolCalls = 10,
    enablePlanning = true,
    logger,
  } = options;

  // Bootstrap or use provided task list
  const taskList = context.taskList
    ? [...context.taskList]
    : enablePlanning
      ? bootstrap(module)
      : [{ id: 1, description: 'Generate output', taskType: 'outputMessage' as const }];

  const executionLog: AgenticTaskExecutionLog[] = context.executionLog
    ? [...context.executionLog]
    : [];
  const startIndex = executionLog.length;

  // Task loop
  for (let i = startIndex; i < taskList.length; i++) {
    // Guard: max tasks
    if (i >= maxTasks) {
      logger?.debug(`Max tasks (${maxTasks}) reached, stopping at task ${i}`);
      break;
    }

    const task = taskList[i];

    const currentContext: AgenticWorkflowContext = {
      ...context,
      taskList,
      executionLog,
      currentTaskIndex: i,
    };

    const logEntry = await executeTask(
      driver, module, currentContext, task, taskList,
      tools, maxToolCalls, logger
    );
    executionLog.push(logEntry);
  }

  // Final output: last task's result
  const lastLog = executionLog[executionLog.length - 1];
  const output = lastLog?.result || '';

  // Determine finishReason
  const hasPendingToolCalls = executionLog.some(
    log => log.pendingToolCalls && log.pendingToolCalls.length > 0
  );
  const finishReason: FinishReason | undefined = hasPendingToolCalls
    ? 'tool_calls'
    : 'stop';

  const totalToolCalls = executionLog.reduce(
    (sum, log) => sum + (log.pendingToolCalls?.length || 0), 0
  );

  return {
    output,
    context: {
      ...context,
      taskList,
      executionLog,
      currentTaskIndex: taskList.length,
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
