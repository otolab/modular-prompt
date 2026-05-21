import type { ChatMessage } from '../formatter/types.js';
import { hasToolCalls, isToolResult } from '../types.js';
import type { ToolDefinition } from '../types.js';
import type { MlxMessage, MlxContentPart } from './types.js';
import type { MlxToolDefinition } from './process/types.js';
import { contentToString, extractImagePaths } from '../content-utils.js';

export { extractImagePaths };

export function convertToolDefinitions(tools: ToolDefinition[]): MlxToolDefinition[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

export function convertMessages(messages: ChatMessage[], vlm: boolean = false): MlxMessage[] {
  return messages.map(msg => {
    // AssistantToolCallMessage - tool_calls付きメッセージ
    if (hasToolCalls(msg)) {
      return {
        role: 'assistant' as const,
        content: msg.content,
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }))
      };
    }

    // ToolResultMessage - ツール結果メッセージ
    if (isToolResult(msg)) {
      let content: string;
      if (msg.kind === 'text') {
        content = String(msg.value);
      } else if (msg.kind === 'data') {
        content = JSON.stringify(msg.value);
      } else {
        content = String(msg.value);
      }
      return {
        role: 'tool' as const,
        content,
        tool_call_id: msg.toolCallId,
        name: msg.name
      };
    }

    // StandardChatMessage - 通常メッセージ（VLM対応含む）
    if (vlm && Array.isArray(msg.content)) {
      const parts: MlxContentPart[] = [];
      for (const att of msg.content) {
        if (att.type === 'image_url' && att.image_url?.url) {
          parts.push({ type: 'image' });
        } else if (att.type === 'text' && att.text) {
          parts.push({ type: 'text', text: att.text });
        }
      }
      if (parts.length > 0) {
        return { role: msg.role as 'system' | 'user' | 'assistant', content: parts };
      }
    }
    return {
      role: msg.role as 'system' | 'user' | 'assistant',
      content: contentToString(msg.content)
    };
  });
}
