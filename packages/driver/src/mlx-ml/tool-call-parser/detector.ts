import type { MlxRuntimeInfo } from '../process/types.js';
import type { SpecialToken, SpecialTokenPair } from '../../formatter/types.js';
import type { DelimiterPair } from './types.js';

const KNOWN_TOOL_PARSER_DELIMITERS: Record<string, DelimiterPair> = {
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

const TOOL_CALL_TOKEN_KEYS = [
  'tool_call', 'tool_call_explicit', 'tool_call_xml',
  'tool_calls_section', 'function_call_tags',
  'longcat_tool_call', 'minimax_tool_call',
] as const;

export interface DetectedDelimiter {
  pair: DelimiterPair;
  source: 'tool_call_format' | 'tool_parser_type' | 'special_tokens';
}

export interface DetectedMarker {
  text: string;
}

export interface DetectionResult {
  delimiters: DetectedDelimiter[];
  marker: DetectedMarker | null;
}

export function detect(runtimeInfo: MlxRuntimeInfo | null): DetectionResult {
  const delimiters: DetectedDelimiter[] = [];
  let marker: DetectedMarker | null = null;

  if (!runtimeInfo) return { delimiters, marker };

  const toolCallFormat = runtimeInfo.features?.chat_template?.tool_call_format;

  if (toolCallFormat?.call_start && toolCallFormat?.call_end) {
    delimiters.push({
      pair: { start: toolCallFormat.call_start, end: toolCallFormat.call_end },
      source: 'tool_call_format',
    });
  }

  if (toolCallFormat?.tool_parser_type) {
    const known = KNOWN_TOOL_PARSER_DELIMITERS[toolCallFormat.tool_parser_type];
    if (known && known.end) {
      delimiters.push({
        pair: known,
        source: 'tool_parser_type',
      });
    }
  }

  for (const key of TOOL_CALL_TOKEN_KEYS) {
    const token = runtimeInfo.special_tokens?.[key];
    if (token && typeof token === 'object' && 'start' in token) {
      const pair = token as SpecialTokenPair;
      delimiters.push({
        pair: { start: pair.start.text, end: pair.end.text },
        source: 'special_tokens',
      });
    }
  }

  const markerToken = runtimeInfo.special_tokens?.['tool_calls_marker'];
  if (markerToken && typeof markerToken === 'object' && 'text' in markerToken) {
    marker = { text: (markerToken as SpecialToken).text };
  }

  return { delimiters, marker };
}

export function lookupDelimiters(parserType: string): DelimiterPair | null {
  return KNOWN_TOOL_PARSER_DELIMITERS[parserType] ?? null;
}
