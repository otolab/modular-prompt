import type { ContentParser, ParsedToolCall } from './types.js';
import { coerceValue, extractBracketedValue } from './utils.js';

export function normalizeJsonToolCall(obj: unknown): ParsedToolCall | null {
  if (typeof obj !== 'object' || obj === null) return null;

  const rec = obj as Record<string, unknown>;

  // {"name": "...", "arguments"|"parameters": {...}}
  if (rec.name && typeof rec.name === 'string') {
    let args = rec.arguments || rec.parameters || {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    if (typeof args !== 'object' || args === null) args = {};
    return { name: rec.name, arguments: args as Record<string, unknown> };
  }

  // {"function": {"name": "...", "arguments": {...}}}
  if (rec.function && typeof rec.function === 'object' && rec.function !== null) {
    const func = rec.function as Record<string, unknown>;
    if (func.name && typeof func.name === 'string') {
      let args = func.arguments || func.parameters || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      if (typeof args !== 'object' || args === null) args = {};
      return { name: func.name, arguments: args as Record<string, unknown> };
    }
  }

  // {"tool": {"name": "...", ...}}
  if (rec.tool && typeof rec.tool === 'object' && rec.tool !== null) {
    const tool = rec.tool as Record<string, unknown>;
    if (tool.name && typeof tool.name === 'string') {
      let args = tool.arguments || tool.parameters || {};
      if (typeof args !== 'object' || args === null) args = {};
      return { name: tool.name, arguments: args as Record<string, unknown> };
    }
  }

  return null;
}

export const jsonParser: ContentParser = {
  name: 'json',
  parse(content: string): ParsedToolCall | ParsedToolCall[] | null {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        const results = parsed
          .map(item => normalizeJsonToolCall(item))
          .filter((item): item is ParsedToolCall => item !== null);
        return results.length > 0 ? results : null;
      }
      return normalizeJsonToolCall(parsed);
    } catch {
      return null;
    }
  },
};

export const gemma4Parser: ContentParser = {
  name: 'gemma4',
  parse(content: string): ParsedToolCall | null {
    const match = content.match(/^call:([\w.-]+)\{([\s\S]*)\}$/);
    if (!match) return null;

    const name = match[1];
    const argsStr = match[2].trim();
    const args: Record<string, unknown> = {};

    if (argsStr) {
      const normalized = argsStr.replace(/<\|"\|>/g, '"');
      let pos = 0;
      while (pos < normalized.length) {
        const keyMatch = normalized.slice(pos).match(/^(\w+):/);
        if (!keyMatch) break;
        const key = keyMatch[1];
        pos += keyMatch[0].length;

        const ch = normalized[pos];
        let value: string;

        if (ch === '"') {
          let end = pos + 1;
          while (end < normalized.length && normalized[end] !== '"') {
            if (normalized[end] === '\\') end++;
            end++;
          }
          value = normalized.slice(pos + 1, end);
          pos = end + 1;
        } else if (ch === '[' || ch === '{') {
          const extracted = extractBracketedValue(normalized, pos);
          if (!extracted) break;
          value = extracted;
          pos += value.length;
        } else {
          const endMatch = normalized.slice(pos).match(/^([^,}]*)/);
          value = endMatch ? endMatch[1].trim() : '';
          pos += endMatch ? endMatch[0].length : 0;
        }

        args[key] = coerceValue(value);

        const sep = normalized.slice(pos).match(/^\s*,\s*/);
        if (sep) pos += sep[0].length;
      }
    }

    return { name, arguments: args };
  },
};

export const pythonicParser: ContentParser = {
  name: 'pythonic',
  parse(content: string): ParsedToolCall | null {
    const match = content.match(/^\[(\w+)\((.*)\)\]$/s);
    if (!match) return null;

    const name = match[1];
    const argsStr = match[2].trim();
    const args: Record<string, unknown> = {};

    if (argsStr) {
      let pos = 0;
      while (pos < argsStr.length) {
        const keyMatch = argsStr.slice(pos).match(/^(\w+)\s*=\s*/);
        if (!keyMatch) break;
        const key = keyMatch[1];
        pos += keyMatch[0].length;

        const ch = argsStr[pos];
        let value: string;

        if (ch === '[' || ch === '{') {
          const extracted = extractBracketedValue(argsStr, pos);
          if (!extracted) break;
          value = extracted;
          pos += value.length;
        } else if (ch === '"' || ch === "'") {
          const quote = ch;
          let end = pos + 1;
          while (end < argsStr.length && argsStr[end] !== quote) {
            if (argsStr[end] === '\\') end++;
            end++;
          }
          value = argsStr.slice(pos + 1, end);
          pos = end + 1;
        } else {
          const endMatch = argsStr.slice(pos).match(/^([^,)]*)/);
          value = endMatch ? endMatch[1].trim() : '';
          pos += endMatch ? endMatch[0].length : 0;
        }

        args[key] = coerceValue(value);

        const sep = argsStr.slice(pos).match(/^\s*,\s*/);
        if (sep) pos += sep[0].length;
      }
    }

    return { name, arguments: args };
  },
};

function parseXmlParams(
  paramsStr: string,
  paramRegex: RegExp,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  let paramMatch;
  while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
    args[paramMatch[1]] = coerceValue(paramMatch[2].trim());
  }
  return args;
}

export const xmlParser: ContentParser = {
  name: 'xml',
  parse(content: string): ParsedToolCall | null {
    // qwen3_coder: <function=name><parameter=key>value</parameter></function>
    const qwenMatch = content.match(/<function=([\w.-]+)>([\s\S]*?)<\/function>/);
    if (qwenMatch) {
      return {
        name: qwenMatch[1],
        arguments: parseXmlParams(qwenMatch[2], /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g),
      };
    }

    // minimax: <invoke name="name"><parameter name="key">value</parameter></invoke>
    const minimaxMatch = content.match(/<invoke\s+name="([\w.]+)">([\s\S]*?)<\/invoke>/);
    if (minimaxMatch) {
      return {
        name: minimaxMatch[1],
        arguments: parseXmlParams(minimaxMatch[2], /<parameter\s+name="(\w+)">([\s\S]*?)<\/parameter>/g),
      };
    }

    // minicpm5: <function name="name"><param name="key">value</param></function>
    const minicpmMatch = content.match(/<function\s+name="([\w.-]+)">([\s\S]*?)<\/function>/);
    if (minicpmMatch) {
      return {
        name: minicpmMatch[1],
        arguments: parseXmlParams(minicpmMatch[2], /<param\s+name="(\w+)">([\s\S]*?)<\/param>/g),
      };
    }

    return null;
  },
};

export const defaultContentParsers: ContentParser[] = [
  jsonParser,
  gemma4Parser,
  pythonicParser,
  xmlParser,
];

export function tryParsers(
  content: string,
  parsers: ContentParser[] = defaultContentParsers,
): ParsedToolCall | ParsedToolCall[] | null {
  for (const parser of parsers) {
    const result = parser.parse(content);
    if (result) return result;
  }
  return null;
}
