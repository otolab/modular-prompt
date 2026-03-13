/**
 * Agentic Workflow - Planning Phase Module
 *
 * 目標を3-5ステップの実行計画に分解する能力をテストする。
 * input: { objective, inputs? }
 */
const module = {
  objective: [
    (ctx) => ctx.objective || '与えられた目標を達成するための実行計画を作成してください。',
  ],
  methodology: [
    '- **Current Phase: Planning**',
    '  - Generate an execution plan by breaking down the Objective into 3-5 executable steps.',
    '  - Output structured JSON text immediately, with no explanations or commentary.',
  ],
  instructions: [
    {
      type: 'subsection',
      title: 'Planning Requirements',
      items: [
        '- Break down the Objective into 3-5 concrete executable steps',
        '- Each step must have: id, description, guidelines (2-4 items), constraints (1-3 items)',
        '- Ensure logical flow between steps',
        '',
        '**Output Format:**',
        '- Respond ONLY with valid JSON text',
        '- NO explanatory text, NO markdown code blocks',
        '- Start directly with { and end with }',
      ],
    },
  ],
  inputs: [(ctx) => (ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null)],
  state: ['Phase: planning'],
  cue: [
    'Respond with a JSON-formatted string containing the execution plan.',
    'Output format: {"steps": [...]}',
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
                guidelines: { type: 'array', items: { type: 'string' } },
                constraints: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'description', 'guidelines', 'constraints'],
            },
          },
        },
        required: ['steps'],
      },
    },
  ],
};

export default module;
