/**
 * Tools実験用モジュール
 */

const module = {
  objective: [
    '- あなたは利用者からの質問に答えるアシスタントです。',
  ],
  instructions: [
    '- 質問の内容に応じて、適切なツールを使ってください。',
    '  - ツールの結果が返ってくるまで、推測で答えないでください。',
    '- 必要がない場合は通常の応答を返します。',
  ],
  messages: [
    (ctx) => ({
      type: 'message',
      role: 'user',
      content: ctx.question || 'Hello',
    }),
  ],
};

export default module;
