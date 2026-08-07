/**
 * chat template 非対応モデル向けのプロンプト組立（Python generate_merged_prompt の TS 移植）
 */

import type { InferenceCapabilities, InferenceMessage } from '../../local-inference/protocol.js';
import type { SpecialToken, SpecialTokenPair } from '../../formatter/types.js';

type SpecialTokensMap = InferenceCapabilities['special_tokens'];

function messageContentToString(content: InferenceMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function isTokenPair(token: SpecialToken | SpecialTokenPair | undefined): token is SpecialTokenPair {
  return !!token && typeof token === 'object' && 'start' in token;
}

/**
 * apply_chat_template が使えない場合に special_tokens からプロンプトを組み立てる
 */
export function generateMergedPrompt(
  messages: InferenceMessage[],
  specialTokens: SpecialTokensMap,
): string {
  const promptParts: string[] = [];

  for (const msg of messages) {
    const role = msg.role;
    const roleUpper = role.toUpperCase();
    const content = messageContentToString(msg.content).trim();

    const roleToken = specialTokens[role];
    if (isTokenPair(roleToken)) {
      promptParts.push(
        roleToken.start.text,
        content,
        roleToken.end.text,
        '',
      );
      continue;
    }

    let blockToken: SpecialTokenPair | undefined;
    for (const candidate of ['block', 'context', 'quote', 'section'] as const) {
      const token = specialTokens[candidate];
      if (isTokenPair(token)) {
        blockToken = token;
        break;
      }
    }

    if (blockToken) {
      promptParts.push(
        `${blockToken.start.text}${roleUpper}:\n${content}`,
        blockToken.end.text,
        '',
      );
    } else {
      promptParts.push(
        `<!-- begin of ${roleUpper} -->`,
        content,
        `<!-- end of ${roleUpper} -->`,
        '',
      );
    }
  }

  if (promptParts.length === 0) {
    return '';
  }
  promptParts.pop();
  return promptParts.join('\n');
}
