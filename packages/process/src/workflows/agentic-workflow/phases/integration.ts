/**
 * Integration phase - combining all task results into final output
 */

import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver } from '../../types.js';
import { WorkflowExecutionError } from '../../types.js';
import type { AgenticWorkflowContext, AgenticTask, AgenticLogger } from '../types.js';
import { agentic } from './common.js';
import { formatLogContentParts, rethrowAsWorkflowError } from '../process/index.js';

/**
 * Integration phase module for agent workflow
 * Phase-specific definitions for integrating all step results
 *
 * Should be merged with agentic and user's module:
 *   merge(agentic, integration, userModule)
 */
export const integration: PromptModule<AgenticWorkflowContext> = {
  methodology: [
    '- **Current Phase: Integration**',
    '  - Integrate results from all executed tasks.',
    '  - Generate the final output that achieves the overall objective.'
  ],

  instructions: [
    {
      type: 'subsection',
      title: 'Integration Phase Process',
      items: [
        '- Integrate execution results from all tasks in the "Execution Plan" to generate the final output',
        '- Verify that the objective has been achieved',
        '- Clearly describe important results from each task'
      ]
    },
    {
      type: 'subsection',
      title: 'Execution Plan (All Tasks Completed)',
      items: [
        (ctx) => {
          if (!ctx.plan) {
            return null;
          }

          return ctx.plan.tasks.map((task: AgenticTask) => {
            return `- ${task.description}`;
          });
        }
      ]
    }
  ],

  state: [
    (ctx) => {
      const total = ctx.plan?.tasks.length || 0;
      return `All ${total} tasks completed. Generating final output.`;
    }
  ],

  materials: [
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0) {
        return null;
      }

      return ctx.executionLog.map((log) => ({
        type: 'material' as const,
        id: `execution-result-${log.taskId}`,
        title: `Execution result: ${log.taskId}`,
        content: formatLogContentParts(log).join('\n\n')
      }));
    }
  ],

  cue: [
    'Integrate all execution results to generate the final output.',
    'Summarize what was accomplished and provide the complete solution to the objective.'
  ]
};

/**
 * Integration phase: combine results into final output
 */
export async function runIntegration(
  driver: AIDriver,
  module: PromptModule<AgenticWorkflowContext>,
  context: AgenticWorkflowContext,
  logger?: AgenticLogger
): Promise<string> {
  const integrationModule = merge(agentic, integration, module);
  const prompt = compile(integrationModule, context);

  try {
    const result = await driver.query(prompt);
    logger?.debug('Integration - AI generated:', result.content);

    if (result.finishReason && result.finishReason !== 'stop') {
      throw new WorkflowExecutionError(
        `Integration failed with reason: ${result.finishReason}`,
        context,
        {
          phase: 'integration',
          partialResult: context.executionLog?.map(log => log.result).join('\n\n') || '',
          finishReason: result.finishReason
        }
      );
    }

    return result.content;
  } catch (error) {
    rethrowAsWorkflowError(error, context, {
      phase: 'integration',
      partialResult: context.executionLog?.map(log => log.result).join('\n\n') || ''
    });
  }
}
