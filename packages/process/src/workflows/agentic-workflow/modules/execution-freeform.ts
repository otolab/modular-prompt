import type { PromptModule } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';

/**
 * Execution phase module (freeform version) for agent workflow
 *
 * This version differs from the standard execution module:
 * - Uses planned dos/donts as instructions (not fixed process steps)
 * - Outputs freeform text (not structured JSON)
 * - Accumulates all previous step decisions
 *
 * Should be merged with agentic and user's module:
 *   merge(agentic, executionFreeform, userModule)
 */
export const executionFreeform: PromptModule<AgenticWorkflowContext> = {
  methodology: [
    (ctx: AgenticWorkflowContext) => {
      const currentStepIndex = (ctx.executionLog?.length || 0) + 1;
      const totalSteps = ctx.plan?.steps.length || 0;
      return [
        `- **Current Phase: Execution (Step ${currentStepIndex}/${totalSteps})**`,
        '  - Execute only the current step of the execution plan.',
        '  - Follow the dos/don\'ts specified in the plan.',
        '  - Output the reasoning process and results as natural text.',
        ''
      ];
    }
  ],

  // Replace user's instructions with plan-based dos/donts
  // Note: User's original instructions are omitted in agentic-workflow.ts
  instructions: [
    (ctx: AgenticWorkflowContext) => {
      const items: string[] = [];

      // Add current step description first
      if (ctx.currentStep?.description) {
        items.push(ctx.currentStep.description);
        items.push('');
      }

      // Add general execution guidelines
      items.push('');
      items.push('**Requirements:**');
      if (ctx.executionLog && ctx.executionLog.length > 0) {
        items.push('- Read and understand the previous step\'s decisions (shown in Data section below)');
        items.push('- Use that understanding to complete THIS step\'s task');
        items.push('- Produce only NEW content for this step');
        items.push('- Do NOT copy or reproduce the previous outputs');
      } else {
        items.push('- Focus on the current step instructions only');
      }
      items.push('- Concise output is acceptable');

      // Add available tools info
      if (ctx.availableTools && ctx.availableTools.length > 0) {
        items.push('');
        items.push('**Available Tools:**');
        ctx.availableTools.forEach(t => {
          items.push(`- **${t.name}**${t.description ? `: ${t.description}` : ''}`);
        });
      }

      // Add guidelines
      if (ctx.currentStep?.guidelines && ctx.currentStep.guidelines.length > 0) {
        items.push('');
        items.push('**Guidelines:**');
        ctx.currentStep.guidelines.forEach((item: string) => items.push(`- ${item}`));
      }

      // Add constraints
      if (ctx.currentStep?.constraints && ctx.currentStep.constraints.length > 0) {
        items.push('');
        items.push('**Constraints:**');
        ctx.currentStep.constraints.forEach((item: string) => items.push(`- ${item}`));
      }

      return items;
    }
  ],

  state: [
    (ctx) => {
      const completed = ctx.executionLog?.length || 0;
      const total = ctx.plan?.steps.length || 0;
      return `Progress: ${completed}/${total} steps completed`;
    },
  ],

  inputs: [
    (ctx) => ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null
  ],

  materials: [
    (ctx) => {
      if (!ctx.executionLog || ctx.executionLog.length === 0) {
        return null;
      }

      return ctx.executionLog.map((log, index) => {
        const parts: string[] = [];

        // Add the step's instructions first
        const stepIndex = index;
        if (ctx.plan?.steps[stepIndex]) {
          const step = ctx.plan.steps[stepIndex];
          const instructionsParts: string[] = [];

          if (step.description) {
            instructionsParts.push(step.description);
          }

          if (step.guidelines && step.guidelines.length > 0) {
            instructionsParts.push('');
            instructionsParts.push('**Guidelines:**');
            step.guidelines.forEach((item: string) => instructionsParts.push(`- ${item}`));
          }

          if (step.constraints && step.constraints.length > 0) {
            instructionsParts.push('');
            instructionsParts.push('**Constraints:**');
            step.constraints.forEach((item: string) => instructionsParts.push(`- ${item}`));
          }

          if (instructionsParts.length > 0) {
            parts.push(`[Instructions]\n${instructionsParts.join('\n')}`);
          }
        }

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
          id: `execution-decision-${log.stepId}`,
          title: `Previous step decision: ${log.stepId}`,
          content: parts.join('\n\n')
        };
      });
    }
  ],

  cue: [
    'IMPORTANT: Follow the Instructions above carefully.',
    'Output only what is required for THIS step based on the Requirements.'
  ]
};
