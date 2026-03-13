/**
 * Agentic Workflow - エンドツーエンドテスト用モジュール
 *
 * agenticProcessに渡すユーザーモジュール。
 * Planning/Execution/Integrationの各フェーズに distributeModule で分配される。
 * input: { objective, inputs? }
 */
const module = {
  objective: [
    (ctx) => ctx.objective || '与えられた目標を達成してください。',
  ],
};

export default module;
