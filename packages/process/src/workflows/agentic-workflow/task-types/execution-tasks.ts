/**
 * Execution task type factory
 *
 * planning と output 以外のタスクタイプは共通構造を持つ。
 * 差分（instruction テキスト、デフォルトオプション）を設定で定義し、
 * ファクトリで PromptModule + TaskTypeConfig を生成する。
 *
 * 新しいタスクタイプの追加:
 * 1. EXECUTION_TASK_DEFS に定義を追加
 * 2. types.ts の TaskType union に追加
 * → レジストリ登録・ツール定義は自動的に反映される
 */

import type { PromptModule, DynamicElement } from '@modular-prompt/core';
import type { AgenticWorkflowContext } from '../types.js';
import type { ModelRole } from '../../driver-input.js';
import type { TaskTypeConfig, MaxTokensTier } from './index.js';

// ---------------------------------------------------------------------------
// Task definition schema
// ---------------------------------------------------------------------------

interface ExecutionTaskDef {
  /** Task-specific objective line (falls back to generic if omitted) */
  objective?: string;
  /** Instruction lines shown before the Focus subsection */
  instructions: string[];
  /** Default driver role */
  driverRole: ModelRole;
  /** Default data options */
  defaults: { withInputs: boolean; withMessages: boolean; withMaterials: boolean };
  /** Description for __insert_tasks tool enum */
  toolDescription: string;
  /** maxTokens tier (default: 'middle') */
  maxTokensTier: MaxTokensTier;
  /** Builtin tool names (default: ['__insert_tasks', '__time']) */
  builtinToolNames?: string[];
}

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

export const EXECUTION_TASK_DEFS: Record<string, ExecutionTaskDef> = {
  think: {
    objective: '- Perform reasoning, analysis, or processing according to your Focus.',
    instructions: [
      '- You will perform reasoning, analysis, or processing as instructed.',
      '- You may call tools if needed to gather information or perform actions.',
      '- If additional tasks are needed to complete the objective, use `__insert_tasks` to register them.',
    ],
    driverRole: 'thinking',
    defaults: { withInputs: false, withMessages: false, withMaterials: false },
    toolDescription: 'produces analysis, reasoning, or processed results',
    maxTokensTier: 'high',
  },
  act: {
    objective: '- Perform the required action using tools according to your Focus.',
    instructions: [
      '- Use tools to perform the action described in your Focus.',
      '- Tool results are automatically passed to subsequent Tasks.',
    ],
    driverRole: 'instruct',
    defaults: { withInputs: false, withMessages: false, withMaterials: false },
    toolDescription: 'performs an external action using tools and reports its outcome',
    maxTokensTier: 'low',
    builtinToolNames: ['__time'],
  },
  verify: {
    objective: '- Verify or validate results from previous Tasks according to your Focus.',
    instructions: [
      '- You will verify or validate results from previous Tasks as instructed.',
      '- Report any issues, inconsistencies, or confirmations clearly.',
      '- If verification fails or results are insufficient, use `__insert_tasks` to register corrective tasks as needed.',
    ],
    driverRole: 'thinking',
    defaults: { withInputs: false, withMessages: false, withMaterials: false },
    toolDescription: 'produces a validation report on previous deliverables',
    maxTokensTier: 'low',
  },
  extractContext: {
    objective: '- Extract relevant information from the provided data according to your Focus.',
    instructions: [
      '- Extract information from the provided inputs, messages, and materials according to your Focus.',
      '- Be exhaustive — do not omit any relevant information.',
      '- Combine direct quoting and summarization: quote key phrases or data verbatim, and summarize surrounding context.',
      '- This is an extraction task: gather and organize what is present in the data. Do not interpret, infer, or add your own reasoning.',
      '- Structure the extracted information clearly so that subsequent Tasks can use it directly.',
    ],
    driverRole: 'thinking',
    defaults: { withInputs: true, withMessages: true, withMaterials: true },
    toolDescription: 'produces structured extraction from inputs/materials',
    maxTokensTier: 'high',
  },
  recall: {
    objective: '- Retrieve information relevant to your Focus using search tools or training knowledge.',
    instructions: [
      '- You will retrieve information relevant to your Focus.',
      '- If search tools are available, formulate appropriate search queries and use them.',
      '- If the information is already known from your training data and no search is needed, return it directly.',
      '- Do not fabricate information. If uncertain, state what you know and what is unverified.',
    ],
    driverRole: 'instruct',
    defaults: { withInputs: false, withMessages: false, withMaterials: false },
    toolDescription: 'produces retrieved knowledge from search tools or training data',
    maxTokensTier: 'middle',
  },
  determine: {
    objective: '- Make a decision or judgment based on the available information according to your Focus.',
    instructions: [
      '- You will make a decision or judgment based on the available information.',
      '- You MUST reach a definitive conclusion. Do not defer, leave open, or suggest further investigation.',
      '- State your conclusion clearly with supporting reasoning.',
    ],
    driverRole: 'thinking',
    defaults: { withInputs: true, withMessages: true, withMaterials: true },
    toolDescription: 'produces a definitive decision with supporting reasoning',
    maxTokensTier: 'middle',
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function buildModule(def: ExecutionTaskDef): PromptModule<AgenticWorkflowContext> {
  const module: PromptModule<AgenticWorkflowContext> = {
    objective: [
      '',
      def.objective ?? '- Execute the current Task according to your Focus.',
    ],

    instructions: [
      ...def.instructions,
      {
        type: 'subsection' as const,
        title: 'Focus',
        items: [
          (ctx: AgenticWorkflowContext) => {
            const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
            return task?.instruction ?? '';
          },
        ],
      },
    ],

    materials: [
      (ctx: AgenticWorkflowContext) => {
        const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
        const withMaterials = task?.withMaterials ?? def.defaults.withMaterials;
        if (!withMaterials || !ctx.userModule?.materials?.length) return null;
        return ctx.userModule.materials as DynamicElement[];
      },
    ],

    inputs: [
      (ctx: AgenticWorkflowContext) => {
        const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
        const withInputs = task?.withInputs ?? def.defaults.withInputs;
        if (!withInputs || !ctx.userModule?.inputs?.length) return null;
        return ctx.userModule.inputs as DynamicElement[];
      },
    ],

    messages: [
      (ctx: AgenticWorkflowContext) => {
        const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
        const withMessages = task?.withMessages ?? def.defaults.withMessages;
        if (!withMessages || !ctx.userModule?.messages?.length) return null;
        return ctx.userModule.messages as DynamicElement[];
      },
    ],
  };

  return module;
}

const DEFAULT_BUILTIN_TOOLS = ['__insert_tasks', '__time'];

function buildConfig(def: ExecutionTaskDef): TaskTypeConfig {
  return {
    module: buildModule(def),
    builtinToolNames: def.builtinToolNames ?? DEFAULT_BUILTIN_TOOLS,
    maxTokensTier: def.maxTokensTier,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** All execution task configs, keyed by task type name */
export const executionTaskConfigs: Record<string, TaskTypeConfig> = Object.fromEntries(
  Object.entries(EXECUTION_TASK_DEFS).map(([name, def]) => [name, buildConfig(def)])
);
