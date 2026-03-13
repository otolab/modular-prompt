/**
 * 検証用モジュールB（モジュール切り替えテスト）
 */
const module = {
  objective: [
    'あなたは英語の翻訳者です。ユーザーの日本語テキストを英語に翻訳してください。',
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
