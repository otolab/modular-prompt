/**
 * Agentic Workflow v2 - タスクタイプ別プロンプトテスト用モジュール
 *
 * ソースコードの taskCommon + 各タスクタイプモジュールを直接使用。
 * experiment.yaml から export フィールドで named export を指定可能。
 */

import { merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { TaskType } from '@modular-prompt/process';
import { taskCommon, getTaskTypeConfig } from '@modular-prompt/process';

interface TaskTypeTestContext {
  userModule?: Record<string, any>;
  inputs?: Record<string, unknown>;
  taskList?: { instruction: string; taskType: string }[];
  currentTaskIndex?: number;
  executionLog?: { taskType: string; result: string }[];
}

const workflowBase: PromptModule<TaskTypeTestContext> = {
  objective: [
    (ctx: TaskTypeTestContext) => {
      const obj = ctx.userModule?.objective;
      if (Array.isArray(obj)) return obj.filter((s: any) => typeof s === 'string').join('\n');
      return obj || null;
    },
  ],
  terms: [
    (ctx: TaskTypeTestContext) => ctx.userModule?.terms || null,
  ],
  cue: [
    (ctx: TaskTypeTestContext) => ctx.userModule?.cue || null,
  ],
  schema: [
    (ctx: TaskTypeTestContext) => ctx.userModule?.schema || null,
  ],
};

function build(taskType: TaskType): PromptModule<TaskTypeTestContext> {
  const config = getTaskTypeConfig(taskType);
  return merge(workflowBase, taskCommon, config.module);
}

export const think = build('think');
export const toolCall = build('toolCall');
export const verify = build('verify');
export const extractContext = build('extractContext');
export const recall = build('recall');
export const determine = build('determine');
export const output = build('output');
