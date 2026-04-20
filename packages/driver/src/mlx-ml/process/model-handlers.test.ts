import { describe, it, expect } from 'vitest';
import { selectResponseProcessor } from './model-handlers.js';
import { parseHarmonyResponse } from './harmony-parser.js';
import type { MlxRuntimeInfo } from './types.js';

describe('selectResponseProcessor', () => {
  it('should return parseHarmonyResponse when tool_parser_type is harmony', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        vocab_size: 32000,
        model_max_length: 4096,
        chat_template: {
          supported_roles: ['system', 'user', 'assistant'],
          tool_call_format: {
            tool_parser_type: 'harmony',
            call_start: 'to=functions.',
            call_end: '<|call|>',
          }
        }
      }
    } as MlxRuntimeInfo;

    const result = selectResponseProcessor('some-model', runtimeInfo);
    expect(result).toBe(parseHarmonyResponse);
  });

  it('should return parseHarmonyResponse for llm-jp-4 model name (fallback)', () => {
    const result = selectResponseProcessor('mlx-community/llm-jp-4-8b-thinking-8bit', null);
    expect(result).toBe(parseHarmonyResponse);
  });

  it('should prioritize tool_parser_type over model name', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        vocab_size: 32000,
        model_max_length: 4096,
        chat_template: {
          supported_roles: ['system', 'user', 'assistant'],
          tool_call_format: {
            tool_parser_type: 'harmony',
            call_start: 'to=functions.',
            call_end: '<|call|>',
          }
        }
      }
    } as MlxRuntimeInfo;

    const result = selectResponseProcessor('unrelated-model-name', runtimeInfo);
    expect(result).toBe(parseHarmonyResponse);
  });

  it('should return null for unknown models without tool_parser_type', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        vocab_size: 32000,
        model_max_length: 4096,
      }
    } as MlxRuntimeInfo;

    const result = selectResponseProcessor('generic-model', runtimeInfo);
    expect(result).toBeNull();
  });

  it('should return null when runtimeInfo is null and model name is unknown', () => {
    const result = selectResponseProcessor('generic-model', null);
    expect(result).toBeNull();
  });

  it('should return null for json_tools parser type', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        vocab_size: 32000,
        model_max_length: 4096,
        chat_template: {
          supported_roles: ['system', 'user', 'assistant'],
          tool_call_format: {
            tool_parser_type: 'json_tools',
            call_start: '<tool_call>',
            call_end: '</tool_call>',
          }
        }
      }
    } as MlxRuntimeInfo;

    const result = selectResponseProcessor('some-model', runtimeInfo);
    expect(result).toBeNull();
  });
});
