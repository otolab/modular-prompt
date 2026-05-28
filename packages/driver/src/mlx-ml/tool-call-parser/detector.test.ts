import { describe, it, expect } from 'vitest';
import { detect } from './detector.js';
import type { MlxRuntimeInfo } from '../process/types.js';

describe('detect', () => {
  it('should return empty result for null runtimeInfo', () => {
    const result = detect(null);
    expect(result.delimiters).toHaveLength(0);
    expect(result.marker).toBeNull();
  });

  it('should detect delimiters from tool_call_format', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        chat_template: {
          supported_roles: ['user', 'assistant'],
          constraints: {},
          tool_call_format: {
            call_start: '<tool_call>',
            call_end: '</tool_call>',
          },
        },
      },
    } as MlxRuntimeInfo;

    const result = detect(runtimeInfo);
    expect(result.delimiters).toHaveLength(1);
    expect(result.delimiters[0].pair).toEqual({ start: '<tool_call>', end: '</tool_call>' });
    expect(result.delimiters[0].source).toBe('tool_call_format');
  });

  it('should detect delimiters from tool_parser_type', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        chat_template: {
          supported_roles: ['user', 'assistant'],
          constraints: {},
          tool_call_format: {
            tool_parser_type: 'pythonic',
          },
        },
      },
    } as MlxRuntimeInfo;

    const result = detect(runtimeInfo);
    expect(result.delimiters).toHaveLength(1);
    expect(result.delimiters[0].pair).toEqual({ start: '<|tool_call_start|>', end: '<|tool_call_end|>' });
    expect(result.delimiters[0].source).toBe('tool_parser_type');
  });

  it('should detect delimiters from special_tokens pair', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_call: {
          start: { text: '<tool_call>', id: 100 },
          end: { text: '</tool_call>', id: 101 },
        },
      },
      features: { apply_chat_template: true },
    } as MlxRuntimeInfo;

    const result = detect(runtimeInfo);
    expect(result.delimiters).toHaveLength(1);
    expect(result.delimiters[0].pair).toEqual({ start: '<tool_call>', end: '</tool_call>' });
    expect(result.delimiters[0].source).toBe('special_tokens');
  });

  it('should detect marker from tool_calls_marker', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_calls_marker: { text: '[TOOL_CALLS]', id: 400 },
      },
      features: { apply_chat_template: true },
    } as MlxRuntimeInfo;

    const result = detect(runtimeInfo);
    expect(result.delimiters).toHaveLength(0);
    expect(result.marker).toEqual({ text: '[TOOL_CALLS]' });
  });

  it('should detect multiple sources simultaneously', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_call: {
          start: { text: '<tool_call>', id: 100 },
          end: { text: '</tool_call>', id: 101 },
        },
      },
      features: {
        apply_chat_template: true,
        chat_template: {
          supported_roles: ['user', 'assistant'],
          constraints: {},
          tool_call_format: {
            call_start: '<tool_call>',
            call_end: '</tool_call>',
          },
        },
      },
    } as MlxRuntimeInfo;

    const result = detect(runtimeInfo);
    expect(result.delimiters.length).toBeGreaterThanOrEqual(2);
    expect(result.delimiters[0].source).toBe('tool_call_format');
    expect(result.delimiters[1].source).toBe('special_tokens');
  });

  it('should skip tool_parser_type with empty end delimiter (mistral)', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        chat_template: {
          supported_roles: ['user', 'assistant'],
          constraints: {},
          tool_call_format: {
            tool_parser_type: 'mistral',
          },
        },
      },
    } as MlxRuntimeInfo;

    const result = detect(runtimeInfo);
    expect(result.delimiters).toHaveLength(0);
  });
});
