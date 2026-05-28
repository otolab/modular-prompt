import type { ToolCall } from '@modular-prompt/core';

export interface ToolCallParseResult {
  content: string;
  toolCalls: ToolCall[];
}

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ContentParser {
  readonly name: string;
  parse(content: string): ParsedToolCall | ParsedToolCall[] | null;
}

export interface DelimiterPair {
  start: string;
  end: string;
}
