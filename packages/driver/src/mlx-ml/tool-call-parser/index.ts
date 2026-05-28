import type { ToolCall } from '@modular-prompt/core';
import type { MlxRuntimeInfo } from '../process/types.js';
import type { ToolCallParseResult, ParsedToolCall } from './types.js';
import { detect } from './detector.js';
import { tryParsers, jsonParser } from './content-parsers.js';
import { escapeRegExp, extractJsonObject } from './utils.js';

export type { ToolCallParseResult } from './types.js';
export type { ContentParser, ParsedToolCall } from './types.js';
export { formatToolDefinitionsAsText } from './tool-formatter.js';

export function parseToolCalls(
  text: string,
  runtimeInfo: MlxRuntimeInfo | null,
): ToolCallParseResult {
  const { delimiters, marker } = detect(runtimeInfo);

  // 1. デリミタベースの検出
  for (const { pair } of delimiters) {
    const result = parseWithDelimiters(text, pair.start, pair.end);
    if (result.toolCalls.length > 0) return result;
  }

  // 2. マーカートークン（Mistral型）
  if (marker) {
    const result = parseMistralStyle(text, marker.text);
    if (result.toolCalls.length > 0) return result;
  }

  // 3. コードブロック
  const codeBlockResult = parseCodeBlocks(text);
  if (codeBlockResult.toolCalls.length > 0) return codeBlockResult;

  // 4. 汎用フォールバック
  return parseGeneric(text);
}

function parseWithDelimiters(
  text: string,
  startDelimiter: string,
  endDelimiter: string,
): ToolCallParseResult {
  const toolCalls: ToolCall[] = [];
  let content = text;
  let callIndex = 0;

  const regex = new RegExp(
    escapeRegExp(startDelimiter) + '([\\s\\S]*?)' + escapeRegExp(endDelimiter),
    'g',
  );

  let match;
  while ((match = regex.exec(text)) !== null) {
    const innerContent = match[1].trim();
    const parsed = tryParsers(innerContent);
    if (parsed) {
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      for (const call of calls) {
        toolCalls.push({
          id: `call_${callIndex++}`,
          name: call.name,
          arguments: call.arguments || {},
        });
      }
    }
  }

  if (toolCalls.length > 0) {
    content = text.replace(regex, '').trim();
  }

  return { content, toolCalls };
}

function parseMistralStyle(text: string, markerText: string): ToolCallParseResult {
  const markerIndex = text.indexOf(markerText);
  if (markerIndex === -1) return { content: text, toolCalls: [] };

  const content = text.substring(0, markerIndex).trim();
  const callText = text.substring(markerIndex + markerText.length).trim();
  const toolCalls: ToolCall[] = [];
  let callIndex = 0;

  try {
    const parsed = JSON.parse(callText);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item.name) {
        toolCalls.push({
          id: `call_${callIndex++}`,
          name: item.name,
          arguments: item.arguments || item.parameters || {},
        });
      }
    }
  } catch {
    // skip
  }

  return { content, toolCalls };
}

function parseCodeBlocks(text: string): ToolCallParseResult {
  const toolCalls: ToolCall[] = [];
  let content = text;
  let callIndex = 0;

  const regex = /```json:toolCall\s*\n([\s\S]*?)```/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      toolCalls.push({
        id: `call_${callIndex++}`,
        name: parsed.name,
        arguments: parsed.arguments || parsed.parameters || {},
      });
    } catch {
      // skip
    }
  }

  if (toolCalls.length > 0) {
    content = text.replace(regex, '').trim();
  }

  return { content, toolCalls };
}

function normalizeJsonToolCall(obj: unknown): ParsedToolCall | null {
  const result = jsonParser.parse(JSON.stringify(obj));
  if (result && !Array.isArray(result)) return result;
  return null;
}

function parseGeneric(text: string): ToolCallParseResult {
  const toolCalls: ToolCall[] = [];
  let content = text;
  let callIndex = 0;
  const matched: string[] = [];

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;

    const jsonStr = extractJsonObject(text, i);
    if (!jsonStr) continue;

    try {
      const parsed = JSON.parse(jsonStr);
      const normalized = normalizeJsonToolCall(parsed);
      if (normalized) {
        toolCalls.push({
          id: `call_${callIndex++}`,
          name: normalized.name,
          arguments: normalized.arguments || {},
        });
        matched.push(jsonStr);
        i += jsonStr.length - 1;
      }
    } catch {
      // skip
    }
  }

  if (matched.length > 0) {
    for (const m of matched) {
      content = content.replace(m, '').trim();
    }
  }

  return { content, toolCalls };
}
