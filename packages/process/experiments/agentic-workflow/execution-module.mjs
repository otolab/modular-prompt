/**
 * Agentic Workflow - Execution Phase Module
 *
 * agenticProcess内部で実際に使われるプロンプトをそのまま利用。
 * merge(agentic, execution, userModule) と同じ構成。
 * input: { objective, plan, currentTask, executionLog?, state?, inputs? }
 */
import { merge } from '@modular-prompt/core';
import { agentic, execution } from '@modular-prompt/process';

const userModule = {
  objective: [
    (ctx) => ctx.objective || '実行計画のステップに従って作業を実行してください。',
  ],
};

export default merge(agentic, execution, userModule);
