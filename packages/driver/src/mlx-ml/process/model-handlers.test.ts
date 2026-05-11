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

  it('should return default processor for unknown models without tool_parser_type', () => {
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
    expect(result).toBeTypeOf('function');
    expect(result).not.toBe(parseHarmonyResponse);
  });

  it('should return default processor when runtimeInfo is null and model name is unknown', () => {
    const result = selectResponseProcessor('generic-model', null);
    expect(result).toBeTypeOf('function');
    expect(result).not.toBe(parseHarmonyResponse);
  });

  it('should return default processor for json_tools parser type', () => {
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
    expect(result).toBeTypeOf('function');
    expect(result).not.toBe(parseHarmonyResponse);
  });

  describe('default processor behavior', () => {
    it('should extract <think> blocks', () => {
      const processor = selectResponseProcessor('generic-model', null);
      const result = processor('<think>分析中</think>回答です。');
      expect(result.content).toBe('回答です。');
      expect(result.thinkingContent).toBe('分析中');
    });

    it('should extract Gemma-4 channel thinking blocks', () => {
      const processor = selectResponseProcessor('generic-model', null);
      const result = processor('<|channel>thought\n分析中<channel|>回答です。');
      expect(result.content).toBe('回答です。');
      expect(result.thinkingContent).toBe('分析中');
    });

    it('should parse tool calls with delimiters when enableToolParsing is true', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {},
        features: {
          apply_chat_template: true,
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

      const processor = selectResponseProcessor('some-model', runtimeInfo, { enableToolParsing: true });
      const result = processor('<tool_call>{"name":"test","arguments":{"a":1}}</tool_call>');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].name).toBe('test');
    });

    it('should not parse tool calls when enableToolParsing is false', () => {
      const processor = selectResponseProcessor('generic-model', null);
      const result = processor('{"name":"test","arguments":{"a":1}}');
      expect(result.content).toBe('{"name":"test","arguments":{"a":1}}');
      expect(result.toolCalls).toBeUndefined();
    });

    it('should return plain content when no thinking or tools', () => {
      const processor = selectResponseProcessor('generic-model', null);
      const result = processor('普通のテキストです。');
      expect(result.content).toBe('普通のテキストです。');
      expect(result.thinkingContent).toBeUndefined();
      expect(result.toolCalls).toBeUndefined();
    });
  });
});
