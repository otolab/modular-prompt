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
  gemma4: { start: '<|tool_call>', end: '<tool_call|>' },
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

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 値を適切な型に変換
 * - 文字列: そのまま
 * - true/false/True/False → boolean
 * - null/None → null
 * - 数値文字列 → number
 */
function coerceValue(value: string | undefined): unknown {
  if (value === undefined) return null;

  // Python形式の変換
  const normalized = value === 'None' ? 'null' : value === 'True' ? 'true' : value === 'False' ? 'false' : value;

  try {
    return JSON.parse(normalized);
  } catch {
    return value;
  }
}

/**
 * JSONオブジェクトを正規化してParsedToolCall形式に変換
 */
function normalizeJsonToolCall(obj: any): ParsedToolCall | null {
  // 標準形式: {"name": "...", "arguments": {...}}
  if (obj.name) {
    let args = obj.arguments || obj.parameters || {};
    // argumentsが文字列の場合（OpenAI形式）
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return { name: obj.name, arguments: args };
  }

  // ネスト形式: {"function": {"name": "...", "arguments": {...}}}
  if (obj.function && typeof obj.function === 'object' && obj.function.name) {
    let args = obj.function.arguments || obj.function.parameters || {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return { name: obj.function.name, arguments: args };
  }

  // tool wrapping: {"tool": {"name": "...", ...}}
  if (obj.tool && typeof obj.tool === 'object' && obj.tool.name) {
    return {
      name: obj.tool.name,
      arguments: obj.tool.arguments || obj.tool.parameters || {}
    };
  }

  return null;
}

/**
 * JSON形式のtool callコンテンツをパース
 */
function parseJsonToolCallContent(
  content: string
): ParsedToolCall | ParsedToolCall[] | null {
  try {
    const parsed = JSON.parse(content);

    // 配列形式
    if (Array.isArray(parsed)) {
      const results = parsed
        .map((item) => normalizeJsonToolCall(item))
        .filter((item): item is ParsedToolCall => item !== null);
      return results.length > 0 ? results : null;
    }

    // オブジェクト形式
    return normalizeJsonToolCall(parsed);
  } catch {
    return null;
  }
}

/**
 * Pythonic形式のtool callコンテンツをパース
 * 例: [func_name(arg1="value", arg2=123)]
 */
function parsePythonicToolCallContent(content: string): ParsedToolCall | null {
  const match = content.match(/^\[(\w+)\((.*)\)\]$/s);
  if (!match) return null;

  const name = match[1];
  const argsStr = match[2].trim();
  const args: Record<string, unknown> = {};

  if (argsStr) {
    // key=value ペアを抽出（値が括弧構造を含む場合は括弧対応で取得）
    let pos = 0;
    while (pos < argsStr.length) {
      // key の抽出
      const keyMatch = argsStr.slice(pos).match(/^(\w+)\s*=\s*/);
      if (!keyMatch) break;
      const key = keyMatch[1];
      pos += keyMatch[0].length;

      // value の抽出
      const ch = argsStr[pos];
      let value: string;

      if (ch === '[' || ch === '{') {
        // 括弧対応で値を抽出
        const extracted = extractBracketedValue(argsStr, pos);
        if (!extracted) break;
        value = extracted;
        pos += value.length;
      } else if (ch === '"' || ch === "'") {
        // 引用符で囲まれた文字列
        const quote = ch;
        let end = pos + 1;
        while (end < argsStr.length && argsStr[end] !== quote) {
          if (argsStr[end] === '\\') end++;
          end++;
        }
        value = argsStr.slice(pos + 1, end);
        pos = end + 1;
      } else {
        // カンマまたは末尾まで
        const endMatch = argsStr.slice(pos).match(/^([^,)]*)/);
        value = endMatch ? endMatch[1].trim() : '';
        pos += endMatch ? endMatch[0].length : 0;
      }

      args[key] = coerceValue(value);

      // カンマをスキップ
      const sep = argsStr.slice(pos).match(/^\s*,\s*/);
      if (sep) pos += sep[0].length;
    }
  }

  return { name, arguments: args };
}

/**
 * 括弧対応で値を抽出（[...] や {...}）
 */
function extractBracketedValue(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * XML形式のtool callコンテンツをパース
 * - qwen3_coder形式: <function=name><parameter=key>value</parameter>...</function>
 * - minimax形式: <invoke name="name"><parameter name="key">value</parameter>...</invoke>
 */
function parseXmlToolCallContent(content: string): ParsedToolCall | null {
  // qwen3_coder形式
  const qwenMatch = content.match(/<function=([\w.-]+)>([\s\S]*?)<\/function>/);
  if (qwenMatch) {
    const name = qwenMatch[1];
    const paramsStr = qwenMatch[2];
    const args: Record<string, unknown> = {};

    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
      args[paramMatch[1]] = coerceValue(paramMatch[2].trim());
    }

    return { name, arguments: args };
  }

  // minimax形式
  const minimaxMatch = content.match(/<invoke\s+name="([\w.]+)">([\s\S]*?)<\/invoke>/);
  if (minimaxMatch) {
    const name = minimaxMatch[1];
    const paramsStr = minimaxMatch[2];
    const args: Record<string, unknown> = {};

    const paramRegex = /<parameter\s+name="(\w+)">([\s\S]*?)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
      args[paramMatch[1]] = coerceValue(paramMatch[2].trim());
    }

    return { name, arguments: args };
  }

  return null;
}

/**
 * Gemma 4形式のtool callコンテンツをパース
 * 例: call:get_weather{location:<|"|>東京<|"|>,limit:10}
 */
function parseGemma4ToolCallContent(content: string): ParsedToolCall | null {
  const match = content.match(/^call:([\w.-]+)\{([\s\S]*)\}$/);
  if (!match) return null;

  const name = match[1];
  const argsStr = match[2].trim();
  const args: Record<string, unknown> = {};

  if (argsStr) {
    // <|"|> を通常の引用符に置換
    const normalized = argsStr.replace(/<\|"\|>/g, '"');

    // key:value ペアを抽出
    let pos = 0;
    while (pos < normalized.length) {
      // key の抽出
      const keyMatch = normalized.slice(pos).match(/^(\w+):/);
      if (!keyMatch) break;
      const key = keyMatch[1];
      pos += keyMatch[0].length;

      // value の抽出
      const ch = normalized[pos];
      let value: string;

      if (ch === '"') {
        // 引用符で囲まれた文字列
        let end = pos + 1;
        while (end < normalized.length && normalized[end] !== '"') {
          if (normalized[end] === '\\') end++;
          end++;
        }
        value = normalized.slice(pos + 1, end);
        pos = end + 1;
      } else if (ch === '[' || ch === '{') {
        // 括弧対応で値を抽出
        const extracted = extractBracketedValue(normalized, pos);
        if (!extracted) break;
        value = extracted;
        pos += value.length;
      } else {
        // カンマまたは末尾まで
        const endMatch = normalized.slice(pos).match(/^([^,}]*)/);
        value = endMatch ? endMatch[1].trim() : '';
        pos += endMatch ? endMatch[0].length : 0;
      }

      args[key] = coerceValue(value);

      // カンマをスキップ
      const sep = normalized.slice(pos).match(/^\s*,\s*/);
      if (sep) pos += sep[0].length;
    }
  }

  return { name, arguments: args };
}

/**
 * 複数形式を試行してtool callコンテンツをパース
 */
function parseToolCallContent(
  content: string
): ParsedToolCall | ParsedToolCall[] | null {
  // 1. JSON形式を試行
  const jsonResult = parseJsonToolCallContent(content);
  if (jsonResult) return jsonResult;

  // 2. Gemma 4形式を試行
  const gemma4Result = parseGemma4ToolCallContent(content);
  if (gemma4Result) return gemma4Result;

  // 3. Pythonic形式を試行
  const pythonicResult = parsePythonicToolCallContent(content);
  if (pythonicResult) return pythonicResult;

  // 4. XML形式を試行
  const xmlResult = parseXmlToolCallContent(content);
  if (xmlResult) return xmlResult;

  return null;
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
    const innerContent = match[1].trim();
    // 複数形式を順次試行
    const parsed = parseToolCallContent(innerContent);
    if (parsed) {
      // parsedが配列の場合もある（glm47等）
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      for (const call of calls) {
        toolCalls.push({
          id: `call_${callIndex++}`,
          name: call.name,
          arguments: call.arguments || {}
        });
      }
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
  const matched: string[] = [];

  // テキスト中の JSON オブジェクトを括弧対応で抽出し、tool call か判定
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
          arguments: normalized.arguments || {}
        });
        matched.push(jsonStr);
        i += jsonStr.length - 1; // skip past this JSON
      }
    } catch {
      // パース失敗 → スキップ
    }
  }

  if (matched.length > 0) {
    for (const m of matched) {
      content = content.replace(m, '').trim();
    }
  }

  return { content, toolCalls };
}

/**
 * テキスト中の位置 start から括弧対応で JSON オブジェクトを抽出
 */
function extractJsonObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
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
 * パラメータ properties を再帰的にフォーマット
 */
function formatProperties(
  lines: string[],
  properties: Record<string, any>,
  required?: string[],
  depth: number = 1
): void {
  const indent = '  '.repeat(depth);
  for (const [name, schema] of Object.entries(properties)) {
    const req = required?.includes(name) ? ' (required)' : '';
    const desc = schema.description ? `: ${schema.description}` : '';
    const type = schema.type || 'any';

    if (type === 'array' && schema.items) {
      lines.push(`${indent}- ${name}: array${req}${desc}`);
      if (schema.items.properties) {
        lines.push(`${indent}  Each item:`);
        formatProperties(lines, schema.items.properties, schema.items.required, depth + 2);
      }
    } else if (type === 'object' && schema.properties) {
      lines.push(`${indent}- ${name}: object${req}${desc}`);
      formatProperties(lines, schema.properties, schema.required, depth + 1);
    } else {
      lines.push(`${indent}- ${name}: ${type}${req}${desc}`);
    }
  }
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
  // ツール定義一覧
  const lines: string[] = ['## Available Tools', ''];
  lines.push('Instead of generating a text response, you can respond with tool call data.');
  lines.push('The result of the tool execution will be provided as context in your next generation.');
  lines.push('Choose a tool from the available list below, determine the appropriate arguments, and output a JSON string in the specified format.');
  lines.push('If a required tool is not in the available list, report this to the user.');
  lines.push('');

  // 具体例を生成するための最初のツール情報を記録
  let exampleToolName: string | undefined;
  let exampleArgs: string | undefined;

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    if (tool.description) {
      lines.push(tool.description);
    }
    if (tool.parameters) {
      const params = tool.parameters as {
        properties?: Record<string, any>;
        required?: string[];
      };
      if (params.properties) {
        lines.push('Parameters:');
        formatProperties(lines, params.properties, params.required, 1);

        // 最初のツールで具体例を生成
        if (!exampleToolName) {
          exampleToolName = tool.name;
          const argEntries: string[] = [];
          for (const [name, schema] of Object.entries(params.properties)) {
            const val = schema.type === 'number' ? '0' : schema.type === 'boolean' ? 'true' : `"..."`;
            argEntries.push(`"${name}": ${val}`);
          }
          exampleArgs = `{${argEntries.join(', ')}}`;
        }
      } else {
        lines.push(`Parameters: ${JSON.stringify(tool.parameters)}`);
      }
    }
    lines.push('');
  }

  // tool call出力フォーマットの指示
  const concreteExample = exampleToolName
    ? `{"name": "${exampleToolName}", "arguments": ${exampleArgs}}`
    : '{"name": "tool_name", "arguments": {"key": "value"}}';

  if (toolCallFormat?.call_start && toolCallFormat?.call_end) {
    lines.push('To call a tool, respond ONLY with:');
    lines.push(toolCallFormat.call_start);
    lines.push(concreteExample);
    lines.push(toolCallFormat.call_end);
  } else {
    const toolCallToken = specialTokens?.tool_call;
    if (toolCallToken && 'start' in toolCallToken && 'end' in toolCallToken) {
      const pair = toolCallToken as SpecialTokenPair;
      lines.push('To call a tool, respond ONLY with:');
      lines.push(`${pair.start.text}`);
      lines.push(concreteExample);
      lines.push(`${pair.end.text}`);
    } else {
      lines.push('To call a tool, respond ONLY with the following format. Do not include any other text before or after the tool call block:');
      lines.push('```json:toolCall');
      lines.push(concreteExample);
      lines.push('```');
    }
  }

  return lines.join('\n');
}
