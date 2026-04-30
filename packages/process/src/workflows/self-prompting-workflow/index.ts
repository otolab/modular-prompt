/**
 * Self-prompting workflow - AI generates complete prompts for each execution step
 *
 * @deprecated agenticProcess に統合予定。新規利用は agenticProcess を使用してください。
 */

export { selfPromptingProcess } from './self-prompting-workflow.js';
export { planning } from './modules/planning.js';
export { integration } from './modules/integration.js';
export type {
  SelfPromptingWorkflowContext,
  SelfPromptingWorkflowOptions,
  SelfPromptingPlan,
  SelfPromptingStep,
  SelfPromptingExecutionLog,
  ActionHandler
} from './types.js';
