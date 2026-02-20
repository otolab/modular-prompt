import type { ToolCall } from '@modular-prompt/core';
import type { MlxRuntimeInfo } from './process/types.js';
import type { ToolDefinition } from '../types.js';
import type { SpecialToken, SpecialTokenPair } from '../formatter/types.js';

export interface ToolCallParseResult {
  /** tool callを除いたテキスト */
  content: string;
  /** 検出されたtool calls */
  toolCalls: ToolCall[];
}

/**
 * モデル出力からtool callを検出・パース
 *
 * 検出戦略:
 * 1. runtimeInfo.features.chat_template.tool_call_format が存在 → テンプレート由来のデリミタで検出
 * 2. runtimeInfo.special_tokens.tool_call が存在 → 特殊トークンによるデリミタで検出
 * 3. ```json:toolCall コードブロック → ラベル付きコードブロック検出
 * 4. 汎用フォールバック → JSON形式のtool call検出
 */
export function parseToolCalls(
  text: string,
  runtimeInfo: MlxRuntimeInfo | null
): ToolCallParseResult {
  // 1. tool_call_format（テンプレート由来）による検出
  const toolCallFormat = runtimeInfo?.features?.chat_template?.tool_call_format;
  if (toolCallFormat?.call_start && toolCallFormat?.call_end) {
    const result = parseWithDelimiters(text, toolCallFormat.call_start, toolCallFormat.call_end);
    if (result.toolCalls.length > 0) {
      return result;
    }
  }

  // 2. 特殊トークンによる検出
  const toolCallToken = runtimeInfo?.special_tokens?.tool_call;
  if (toolCallToken && typeof toolCallToken === 'object' && 'start' in toolCallToken) {
    const result = parseWithDelimiters(
      text,
      toolCallToken.start.text,
      toolCallToken.end.text
    );
    if (result.toolCalls.length > 0) {
      return result;
    }
  }

  // 3. ```json:toolCall コードブロック検出
  const codeBlockResult = parseCodeBlockToolCalls(text);
  if (codeBlockResult.toolCalls.length > 0) {
    return codeBlockResult;
  }

  // 4. 汎用フォールバック
  return parseGenericToolCalls(text);
}

function parseWithDelimiters(
  text: string,
  startDelimiter: string,
  endDelimiter: string
): ToolCallParseResult {
  const toolCalls: ToolCall[] = [];
  let content = text;
  let callIndex = 0;

  // startDelimiter...endDelimiter のパターンを繰り返し検索
  const regex = new RegExp(
    escapeRegExp(startDelimiter) + '([\\s\\S]*?)' + escapeRegExp(endDelimiter),
    'g'
  );

  let match;
  while ((match = regex.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      toolCalls.push({
        id: `call_${callIndex++}`,
        name: parsed.name,
        arguments: parsed.arguments || parsed.parameters || {}
      });
    } catch {
      // JSONパース失敗 → スキップ
    }
  }

  if (toolCalls.length > 0) {
    // tool call部分をテキストから除去
    content = text.replace(regex, '').trim();
  }

  return { content, toolCalls };
}

function parseCodeBlockToolCalls(text: string): ToolCallParseResult {
  const toolCalls: ToolCall[] = [];
  let content = text;
  let callIndex = 0;

  // ```json:toolCall ... ``` パターンを検出
  const codeBlockRegex = /```json:toolCall\s*\n([\s\S]*?)```/g;

  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      toolCalls.push({
        id: `call_${callIndex++}`,
        name: parsed.name,
        arguments: parsed.arguments || parsed.parameters || {}
      });
    } catch {
      // JSONパース失敗 → スキップ
    }
  }

  if (toolCalls.length > 0) {
    content = text.replace(codeBlockRegex, '').trim();
  }

  return { content, toolCalls };
}

function parseGenericToolCalls(text: string): ToolCallParseResult {
  const toolCalls: ToolCall[] = [];
  let content = text;
  let callIndex = 0;

  // 汎用パターン: {"name": "...", "arguments": {...}} を検出
  // 行頭からJSONオブジェクトが始まるか、テキスト末尾のJSONブロックを検出
  const jsonPattern = /\{[\s\S]*?"name"\s*:\s*"[^"]+?"[\s\S]*?(?:"arguments"|"parameters")\s*:\s*\{[\s\S]*?\}\s*\}/g;

  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.name && (parsed.arguments || parsed.parameters)) {
        toolCalls.push({
          id: `call_${callIndex++}`,
          name: parsed.name,
          arguments: parsed.arguments || parsed.parameters || {}
        });
      }
    } catch {
      // JSONパース失敗 → スキップ
    }
  }

  if (toolCalls.length > 0) {
    // tool call部分をテキストから除去（最後のJSON部分のみ）
    for (const match2 of [...text.matchAll(jsonPattern)]) {
      content = content.replace(match2[0], '').trim();
    }
  }

  return { content, toolCalls };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * tool定義をテキスト形式にフォーマット
 * tool_call_formatまたは特殊トークンがある場合はそのフォーマットに合わせた指示を生成
 */
export function formatToolDefinitionsAsText(
  tools: ToolDefinition[],
  specialTokens?: Record<string, SpecialToken | SpecialTokenPair>,
  toolCallFormat?: { call_start?: string; call_end?: string }
): string {
  const lines: string[] = ['## Available Tools', ''];

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    if (tool.description) {
      lines.push(tool.description);
    }
    if (tool.parameters) {
      lines.push(`Parameters: ${JSON.stringify(tool.parameters)}`);
    }
    lines.push('');
  }

  // tool call出力フォーマットの指示
  if (toolCallFormat?.call_start && toolCallFormat?.call_end) {
    lines.push('To call a tool, respond with:');
    lines.push(toolCallFormat.call_start);
    lines.push('{"name": "tool_name", "arguments": {"param": "value"}}');
    lines.push(toolCallFormat.call_end);
  } else {
    const toolCallToken = specialTokens?.tool_call;
    if (toolCallToken && 'start' in toolCallToken && 'end' in toolCallToken) {
      const pair = toolCallToken as SpecialTokenPair;
      lines.push('To call a tool, respond with:');
      lines.push(`${pair.start.text}`);
      lines.push('{"name": "tool_name", "arguments": {"param": "value"}}');
      lines.push(`${pair.end.text}`);
    } else {
      lines.push('To call a tool, respond with:');
      lines.push('```json:toolCall');
      lines.push('{"name": "tool_name", "arguments": {"param": "value"}}');
      lines.push('```');
    }
  }

  return lines.join('\n');
}
