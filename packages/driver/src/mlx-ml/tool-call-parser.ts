import type { ToolCall } from '@modular-prompt/core';
import type { MlxRuntimeInfo } from './process/types.js';
import type { ToolDefinition } from '../types.js';
import type { SpecialToken, SpecialTokenPair } from '../formatter/types.js';

/** tool_call関連のspecial_tokensキー名リスト */
const TOOL_CALL_TOKEN_KEYS = [
  'tool_call', 'tool_call_explicit', 'tool_call_xml',
  'tool_calls_section', 'function_call_tags',
  'longcat_tool_call', 'minimax_tool_call'
] as const;

/** 既知のtool parserとデリミタのマッピング */
const KNOWN_TOOL_PARSER_DELIMITERS: Record<string, { start: string; end: string }> = {
  json_tools: { start: '<tool_call>', end: '</tool_call>' },
  pythonic: { start: '<|tool_call_start|>', end: '<|tool_call_end|>' },
  function_gemma: { start: '<start_function_call>', end: '<end_function_call>' },
  mistral: { start: '[TOOL_CALLS]', end: '' },
  kimi_k2: { start: '<|tool_calls_section_begin|>', end: '<|tool_calls_section_end|>' },
  longcat: { start: '<longcat_tool_call>', end: '</longcat_tool_call>' },
  glm47: { start: '<tool_call>', end: '</tool_call>' },
  qwen3_coder: { start: '<tool_call>', end: '</tool_call>' },
  minimax_m2: { start: '<minimax:tool_call>', end: '</minimax:tool_call>' },
};

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

  // 1.5. tool_parser_type から既知デリミタで検出
  if (toolCallFormat?.tool_parser_type) {
    const known = KNOWN_TOOL_PARSER_DELIMITERS[toolCallFormat.tool_parser_type];
    if (known && known.end) {
      const result = parseWithDelimiters(text, known.start, known.end);
      if (result.toolCalls.length > 0) {
        return result;
      }
    }
  }

  // 2. 特殊トークンによる検出（拡張：複数のキー名を検索）
  for (const key of TOOL_CALL_TOKEN_KEYS) {
    const toolCallToken = runtimeInfo?.special_tokens?.[key];
    if (toolCallToken && typeof toolCallToken === 'object' && 'start' in toolCallToken) {
      const pair = toolCallToken as SpecialTokenPair;
      const result = parseWithDelimiters(text, pair.start.text, pair.end.text);
      if (result.toolCalls.length > 0) {
        return result;
      }
    }
  }

  // 2.5. 単体マーカートークンによる検出（Mistral型）
  const toolCallsMarker = runtimeInfo?.special_tokens?.['tool_calls_marker'];
  if (toolCallsMarker && typeof toolCallsMarker === 'object' && 'text' in toolCallsMarker) {
    const markerToken = toolCallsMarker as SpecialToken;
    const result = parseMistralStyleToolCalls(text, markerToken.text);
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

function parseMistralStyleToolCalls(
  text: string,
  marker: string
): ToolCallParseResult {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return { content: text, toolCalls: [] };
  }

  const content = text.substring(0, markerIndex).trim();
  const callText = text.substring(markerIndex + marker.length).trim();
  const toolCalls: ToolCall[] = [];
  let callIndex = 0;

  // JSONオブジェクトを抽出
  try {
    const parsed = JSON.parse(callText);
    if (parsed.name) {
      toolCalls.push({
        id: `call_${callIndex++}`,
        name: parsed.name,
        arguments: parsed.arguments || parsed.parameters || {}
      });
    } else if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.name) {
          toolCalls.push({
            id: `call_${callIndex++}`,
            name: item.name,
            arguments: item.arguments || item.parameters || {}
          });
        }
      }
    }
  } catch {
    // JSONパース失敗 → スキップ
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
  toolCallFormat?: { call_start?: string; call_end?: string; tool_parser_type?: string }
): string {
  const lines: string[] = ['## Available Tools', ''];

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    if (tool.description) {
      lines.push(tool.description);
    }
    if (tool.parameters) {
      // パラメータを簡潔に表現
      const params = tool.parameters as {
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
      };
      if (params.properties) {
        lines.push('Parameters:');
        for (const [name, schema] of Object.entries(params.properties)) {
          const req = params.required?.includes(name) ? ' (required)' : '';
          const desc = schema.description ? `: ${schema.description}` : '';
          lines.push(`- ${name}: ${schema.type || 'any'}${req}${desc}`);
        }
      } else {
        lines.push(`Parameters: ${JSON.stringify(tool.parameters)}`);
      }
    }
    lines.push('');
  }

  // tool call出力フォーマットの指示（既存ロジック維持）
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
