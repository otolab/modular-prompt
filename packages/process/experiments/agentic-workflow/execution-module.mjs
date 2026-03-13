/**
 * Agentic Workflow v2 - Think タスクタイプのプロンプトテスト用
 *
 * think タスクのプロンプト構造を defaultProcess 経由でテストする。
 * input: { objective, taskList?, currentTaskIndex?, executionLog?, inputs? }
 */
const module = {
  objective: [
    (ctx) => ctx.objective || '実行計画のタスクに従って作業を実行してください。',
  ],

  methodology: [
    (ctx) => {
      const taskList = ctx.taskList || [];
      const currentIndex = ctx.currentTaskIndex ?? 0;
      const lines = taskList.map((t, i) => {
        const status = i < currentIndex ? '[completed]' : i === currentIndex ? '[current]' : '[pending]';
        return `- Task ${t.id} (${t.taskType}): ${t.description} ${status}`;
      });
      return `**Current Phase: Execution (Think)**\n\nTask List:\n${lines.join('\n')}`;
    },
  ],

  instructions: [
    (ctx) => {
      const currentTask = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
      if (!currentTask) return null;
      return {
        type: 'subsection',
        title: 'Task Instructions',
        items: [currentTask.description],
      };
    },
  ],

  inputs: [(ctx) => (ctx.inputs ? JSON.stringify(ctx.inputs, null, 2) : null)],
};

export default module;
