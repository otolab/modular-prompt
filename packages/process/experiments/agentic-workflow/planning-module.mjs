/**
 * Agentic Workflow - Planning Phase Module
 *
 * agenticProcess内部で実際に使われるプロンプトをそのまま利用。
 * merge(agentic, planning, userModule) と同じ構成。
 * input: { objective, inputs? }
 */
import { merge } from '@modular-prompt/core';
import { agentic, planning } from '@modular-prompt/process';

const userModule = {
  objective: [
    (ctx) => ctx.objective || '与えられた目標を達成するための実行計画を作成してください。',
  ],
};

export default merge(agentic, planning, userModule);
