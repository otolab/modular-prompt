/**
 * Agentic workflow - Execution phase module
 *
 * Tests whether the model can execute a step correctly,
 * including tool calling decisions.
 * Tools are passed via queryOptions in the test case.
 */

import { merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { agentic, execution } from '@modular-prompt/process';
import type { AgenticWorkflowContext } from '@modular-prompt/process';

const userModule: PromptModule<AgenticWorkflowContext> = {
  objective: [
    '実行計画のステップに従って作業を実行してください。',
    '必要に応じてツールを使用してください。',
  ],
};

export default merge(agentic, execution, userModule);
