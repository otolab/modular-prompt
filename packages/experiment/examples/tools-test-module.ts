/**
 * Tools実験用モジュール
 */

import { compile } from '@modular-prompt/core';

export default {
  name: 'tools-test',
  description: 'ツール呼び出し実験用モジュール',
  compile: (context: any) => {
    return compile({
      objective: [
        'あなたはツールを使って質問に答えるアシスタントです。',
        '必要に応じてツールを呼び出してください。',
      ],
      instructions: [
        '質問の内容に応じて、適切なツールを使ってください。',
        'ツールの結果が返ってくるまで、推測で答えないでください。',
      ],
      messages: [
        {
          type: 'message' as const,
          role: 'user' as const,
          content: context.question || 'Hello',
        },
      ],
    });
  },
};
