/**
 * MessageElement Formatter
 */

import type { MessageElement } from '@modular-prompt/core';
import type { SpecialToken, SpecialTokenPair } from '../types.js';
import { BaseElementFormatter } from './base.js';

export class MessageElementFormatter extends BaseElementFormatter<MessageElement> {
  readonly elementType = 'message' as const;

  constructor(private modelName: string) {
    super();
  }

  async format(
    element: MessageElement,
    specialTokens?: Record<string, SpecialToken | SpecialTokenPair>
  ): Promise<string> {
    // Convert content to string based on message type
    let contentStr: string;
    if (element.role === 'tool') {
      // ToolResultMessageElement
      switch (element.kind) {
        case 'text':
          contentStr = String(element.value);
          break;
        case 'data':
          contentStr = JSON.stringify(element.value);
          break;
        case 'error':
          contentStr = String(element.value);
          break;
        default:
          contentStr = String(element.value);
      }
    } else {
      // StandardMessageElement
      contentStr = typeof element.content === 'string'
        ? element.content
        : JSON.stringify(element.content);
    }

    // 特殊トークンが利用可能な場合は使用
    if (specialTokens) {
      const roleTokens = this.getToken(specialTokens, element.role);
      if (roleTokens) {
        return `${roleTokens.start}${contentStr}${roleTokens.end}\n`;
      }
    }

    // モデル固有のフォールバック処理
    if (this.modelName.includes('gemma-3')) {
      const roleMap = {
        system: 'user',  // Gemma-3はsystemロールをサポートしない
        user: 'user',
        assistant: 'model'
      };
      const role = roleMap[element.role as keyof typeof roleMap] || 'user';
      // Gemma-3のデフォルトトークン
      return `<start_of_turn>${role}\n${contentStr}<end_of_turn>\n`;
    }

    // デフォルトは通常のテキスト形式
    return `[${element.role.toUpperCase()}]\n${contentStr}\n`;
  }
}