import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext, AgenticStep } from '../types.js';

/**
 * Execution phase module for agent workflow
 * Phase-specific definitions for executing a single step
 *
 * Should be merged with agentic and user's module:
 *   merge(agentic, execution, userModule)
 */
export const execution: PromptModule<AgenticWorkflowContext> = {
  methodology: [
    '',
    '**Current Phase: Execution**',
    '',
    '- Execute only the current step of the execution plan.',
    '- Output the reasoning process and results as structured JSON text.'
  ],

  instructions: [
    {
      type: 'subsection',
      title: 'Execution Phase Process',
      items: [
        '- Focus solely on completing the current step',
        '- Use available tools if needed to accomplish the step',
        '- Output result and nextState in a structured format'
      ]
    },
    {
      type: 'subsection',
      title: 'Available Tools',
      items: [
        (ctx: AgenticWorkflowContext) => {
          if (!ctx.availableTools || ctx.availableTools.length === 0) {
            return '- No tools are available';
          }
          return ctx.availableTools.map(t =>
            `- **${t.name}**${t.description ? `: ${t.description}` : ''}`
          );
        }
      ]
    },
    {
      type: 'subsection',
      title: 'Execution Plan',
      items: [
        (ctx) => {
          if (!ctx.plan) {
            return null;
          }

          const currentStepId = ctx.currentStep?.id;

          return ctx.plan.steps.map((step: AgenticStep) => {
            const baseText = step.description;

            // For currently executing step, show guidelines/constraints
            if (step.id === currentStepId) {
              const details: string[] = [`- **${baseText}** ← **[Currently executing]**`];

              if (step.guidelines && step.guidelines.length > 0) {
                details.push('  **Guidelines:**');
                step.guidelines.forEach(item => details.push(`  - ${item}`));
              }

              if (step.constraints && step.constraints.length > 0) {
                details.push('  **Constraints:**');
                step.constraints.forEach(item => details.push(`  - ${item}`));
              }

              return details;
            }

            return `- ${baseText}`;
          }).flat();
        }
      ]
    }
  ],

  state: [
    (ctx) => {
      const completed = ctx.executionLog?.length || 0;
      const total = ctx.plan?.steps.length || 0;
      return `Progress: ${completed}/${total} steps completed`;
    },
    (ctx) => {
      if (ctx.state) {
        return `Handover from previous step: ${ctx.state.content}`;
      }
      return null;
    }
  ],

  inputs: [
    (ctx) => ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null
  ],

  materials: [
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0 || !ctx.plan) {
        return null;
      }

      return ctx.executionLog.map((log) => {
        // Find the corresponding step to get guidelines/constraints
        const step = ctx.plan!.steps.find((s: AgenticStep) => s.id === log.stepId);

        const contentParts: string[] = [];

        // Instructions section
        if (step) {
          contentParts.push('## Instructions');
          contentParts.push('');
          contentParts.push(step.description);
          contentParts.push('');

          if (step.guidelines && step.guidelines.length > 0) {
            contentParts.push('**Guidelines:**');
            step.guidelines.forEach(item => contentParts.push(`- ${item}`));
            contentParts.push('');
          }

          if (step.constraints && step.constraints.length > 0) {
            contentParts.push('**Constraints:**');
            step.constraints.forEach(item => contentParts.push(`- ${item}`));
            contentParts.push('');
          }
        }

        // Result section
        contentParts.push('## Result');
        contentParts.push('');

        if (log.reasoning) {
          contentParts.push('**Reasoning:**');
          contentParts.push(log.reasoning);
          contentParts.push('');
        }

        contentParts.push(log.result);

        if (log.toolCalls && log.toolCalls.length > 0) {
          contentParts.push('');
          contentParts.push('**Tool Calls:**');
          for (const tc of log.toolCalls) {
            const resultStr = typeof tc.result === 'string'
              ? tc.result
              : JSON.stringify(tc.result, null, 2);
            contentParts.push(`- ${tc.name}(${JSON.stringify(tc.arguments)}) → ${resultStr}`);
          }
        }

        return {
          type: 'material' as const,
          id: `previous-step-${log.stepId}`,
          title: `Previous step decision: ${log.stepId}`,
          content: contentParts.join('\n')
        };
      });
    }
  ],

  cue: [
    'Output a JSON object containing the execution result of the current step following the JSON Output Format below.',
    'Generate actual data (an object with reasoning, result, and nextState properties), not the JSON Schema definition itself.'
  ],

  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          reasoning: {
            type: 'string',
            description: 'Thought process and analysis: Explain your thinking, considerations, and decision-making process for this step.'
          },
          result: {
            type: 'string',
            description: 'Execution result: Describe what was actually done in this step and what concrete results were obtained.'
          },
          nextState: {
            type: 'string',
            description: 'Handover note for the next step (simple text, not object/array)'
          }
        },
        required: ['reasoning', 'result', 'nextState']
      }
    }
  ]
};
