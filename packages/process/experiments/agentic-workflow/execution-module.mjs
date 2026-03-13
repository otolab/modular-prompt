/**
 * Agentic Workflow - Execution Phase Module
 *
 * 計画のステップを実行し、reasoning/result/nextStateを出力する能力をテストする。
 * ツールが利用可能な場合はtool callingの判断もテストする。
 * input: { objective, plan, currentStep, inputs?, state? }
 */
const module = {
  objective: [
    (ctx) => ctx.objective || '実行計画のステップに従って作業を実行してください。',
  ],
  methodology: [
    '**Current Phase: Execution**',
    '',
    '- Execute only the current step of the execution plan.',
    '- Use available tools if needed to accomplish the step.',
    '- Output the reasoning process and results as structured JSON text.',
  ],
  instructions: [
    {
      type: 'subsection',
      title: 'Execution Phase Process',
      items: [
        '- Focus solely on completing the current step',
        '- Use available tools if needed',
        '- Output result and nextState in a structured format',
      ],
    },
    {
      type: 'subsection',
      title: 'Execution Plan',
      items: [
        (ctx) => {
          if (!ctx.plan) return null;
          const currentId = ctx.currentStep?.id;
          return ctx.plan.steps
            .map((step) => {
              if (step.id === currentId) {
                const lines = [`- **${step.description}** ← **[Currently executing]**`];
                if (step.guidelines?.length) {
                  lines.push('  **Guidelines:**');
                  step.guidelines.forEach((g) => lines.push(`  - ${g}`));
                }
                if (step.constraints?.length) {
                  lines.push('  **Constraints:**');
                  step.constraints.forEach((c) => lines.push(`  - ${c}`));
                }
                return lines;
              }
              return `- ${step.description}`;
            })
            .flat();
        },
      ],
    },
  ],
  state: [
    (ctx) => {
      const completed = ctx.executionLog?.length || 0;
      const total = ctx.plan?.steps.length || 0;
      return `Progress: ${completed}/${total} steps completed`;
    },
    (ctx) => (ctx.state ? `Handover from previous step: ${ctx.state.content}` : null),
  ],
  inputs: [(ctx) => (ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null)],
  cue: [
    'Output a JSON object with reasoning, result, and nextState properties.',
    'Generate actual data, not the JSON Schema definition itself.',
  ],
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          reasoning: {
            type: 'string',
            description: 'Thought process and analysis',
          },
          result: {
            type: 'string',
            description: 'Execution result',
          },
          nextState: {
            type: 'string',
            description: 'Handover note for the next step',
          },
        },
        required: ['reasoning', 'result', 'nextState'],
      },
    },
  ],
};

export default module;
