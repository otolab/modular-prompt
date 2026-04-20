import type { ToolCall } from '../../types.js';

export interface ResponseParseResult {
  content: string;
  thinkingContent?: string;
  toolCalls?: ToolCall[];
}

export type ResponseProcessor = (rawText: string) => ResponseParseResult;
