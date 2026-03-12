import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext, AgenticStep } from '../types.js';

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
    '  - Integrate results from all executed steps.',
    '  - Generate the final output that achieves the overall objective.'
  ],

  instructions: [
    {
      type: 'subsection',
      title: 'Integration Phase Process',
      items: [
        '- Integrate execution results from all steps in the "Execution Plan" to generate the final output',
        '- Verify that the objective has been achieved',
        '- Clearly describe important results from each step'
      ]
    },
    {
      type: 'subsection',
      title: 'Execution Plan (All Steps Completed)',
      items: [
        (ctx) => {
          if (!ctx.plan) {
            return null;
          }

          return ctx.plan.steps.map((step: AgenticStep) => {
            return `- ${step.description}`;
          });
        }
      ]
    }
  ],

  state: [
    (ctx) => {
      const total = ctx.plan?.steps.length || 0;
      return `All ${total} steps completed. Generating final output.`;
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

      return ctx.executionLog.map((log) => {
        const parts: string[] = [];

        if (log.reasoning) {
          parts.push(`[Reasoning]\n${log.reasoning}`);
        }

        parts.push(`[Result]\n${log.result}`);

        if (log.toolCalls && log.toolCalls.length > 0) {
          const toolCallStr = log.toolCalls.map(tc => {
            const resultStr = typeof tc.result === 'string'
              ? tc.result
              : JSON.stringify(tc.result, null, 2);
            return `- ${tc.name}(${JSON.stringify(tc.arguments)}) → ${resultStr}`;
          }).join('\n');
          parts.push(`[Tool Calls]\n${toolCallStr}`);
        }

        return {
          type: 'material' as const,
          id: `execution-result-${log.stepId}`,
          title: `Execution result: ${log.stepId}`,
          content: parts.join('\n\n')
        };
      });
    }
  ],

  cue: [
    'Integrate all execution results to generate the final output.',
    'Summarize what was accomplished and provide the complete solution to the objective.'
  ]
};
