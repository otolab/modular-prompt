/**
 * Tools実験用モジュール
 */

import { compile } from '@modular-prompt/core';

export default {
  name: 'tools-test',
  description: 'ツール呼び出し実験用モジュール',
  compile: (context) => {
    return compile({
      objective: [
        '- あなたは利用者からの質問に答えるアシスタントです。',
      ],
      instructions: [
        '- 質問の内容に応じて、適切なツールを使ってください。',
        '  - ツールの結果が返ってくるまで、推測で答えないでください。',
        '- 必要がない場合は通常の応答を返します。',
      ],
      messages: [
        {
          type: 'message',
          role: 'user',
          content: context.question || 'Hello',
        },
      ],
    });
  },
};
