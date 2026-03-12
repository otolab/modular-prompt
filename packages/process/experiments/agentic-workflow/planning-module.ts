/**
 * Agentic workflow - Planning phase module
 *
 * Tests whether the model can generate a valid execution plan
 * with proper step structure (id, description, guidelines, constraints).
 */

import { merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { agentic, planning } from '@modular-prompt/process';
import type { AgenticWorkflowContext } from '@modular-prompt/process';

const userModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '与えられた目標を達成するための実行計画を作成してください。',
  ],
};

export default merge(agentic, planning, userModule);
