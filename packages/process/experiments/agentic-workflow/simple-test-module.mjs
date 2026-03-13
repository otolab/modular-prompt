/**
 * MLX連続クエリ検証用の最小モジュール
 */
const module = {
  objective: [
    'ユーザーの質問に日本語で簡潔に回答してください。',
  ],
  messages: [
    (ctx) => ({
      type: 'message',
      role: 'user',
      content: ctx.question || 'こんにちは',
    }),
  ],
};

export default module;
