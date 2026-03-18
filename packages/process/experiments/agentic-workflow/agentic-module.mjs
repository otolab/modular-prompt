/**
 * Agentic Workflow v2 - エンドツーエンドテスト用モジュール
 *
 * agenticProcess に渡すユーザーモジュール。
 * 各タスクタイプが buildModule で必要なセクションを取得する。
 * input: { objective, inputs? }
 */
const module = {
  objective: [
    (ctx) => ctx.objective || '与えられた目標を達成してください。',
  ],
};

export default module;
