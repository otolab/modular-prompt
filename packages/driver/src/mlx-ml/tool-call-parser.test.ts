import { describe, it, expect } from 'vitest';
import { parseToolCalls, formatToolDefinitionsAsText } from './tool-call-parser.js';
import type { MlxRuntimeInfo } from './process/types.js';
import type { ToolDefinition } from '../types.js';

describe('parseToolCalls', () => {
  describe('特殊トークンによる検出', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_call: {
          start: { text: '<tool_call>', id: 100 },
          end: { text: '</tool_call>', id: 101 }
        }
      },
      features: { apply_chat_template: true }
    } as MlxRuntimeInfo;

    it('should detect single tool call with delimiters', () => {
      const text = 'Let me check the weather.\n<tool_call>\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_0',
        name: 'get_weather',
        arguments: { location: 'Tokyo' }
      });
      expect(result.content).toBe('Let me check the weather.');
    });

    it('should detect multiple tool calls', () => {
      const text = '<tool_call>\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n</tool_call>\n<tool_call>\n{"name": "get_weather", "arguments": {"location": "Osaka"}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].id).toBe('call_0');
      expect(result.toolCalls[1].id).toBe('call_1');
      expect(result.toolCalls[0].arguments).toEqual({ location: 'Tokyo' });
      expect(result.toolCalls[1].arguments).toEqual({ location: 'Osaka' });
    });

    it('should handle "parameters" key as alias for "arguments"', () => {
      const text = '<tool_call>\n{"name": "get_weather", "parameters": {"city": "NYC"}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].arguments).toEqual({ city: 'NYC' });
    });

    it('should skip invalid JSON inside delimiters', () => {
      const text = '<tool_call>\nnot valid json\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return original text when no tool calls found', () => {
      const text = 'Just a regular response with no tool calls.';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(0);
      expect(result.content).toBe(text);
    });
  });

  describe('汎用フォールバック', () => {
    it('should detect tool call from JSON pattern without special tokens', () => {
      const text = '{"name": "get_weather", "arguments": {"location": "Tokyo"}}';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].arguments).toEqual({ location: 'Tokyo' });
    });

    it('should detect tool call with preceding text', () => {
      const text = 'I will check the weather.\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.content).toBe('I will check the weather.');
    });

    it('should return no tool calls for regular text', () => {
      const text = 'This is just a normal response without any tool usage.';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(0);
      expect(result.content).toBe(text);
    });

    it('should handle runtimeInfo without tool_call tokens', () => {
      const runtimeInfoNoToolCall = {
        methods: ['chat'],
        special_tokens: {
          eod: { text: '</s>', id: 2 }
        },
        features: { apply_chat_template: true }
      } as MlxRuntimeInfo;

      const text = '{"name": "get_weather", "arguments": {"location": "Tokyo"}}';
      const result = parseToolCalls(text, runtimeInfoNoToolCall);

      expect(result.toolCalls).toHaveLength(1);
    });
  });

  describe('json:toolCallコードブロック検出', () => {
    it('should detect tool call in json:toolCall code block', () => {
      const text = 'Let me check.\n```json:toolCall\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n```';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_0',
        name: 'get_weather',
        arguments: { location: 'Tokyo' }
      });
      expect(result.content).toBe('Let me check.');
    });

    it('should detect multiple json:toolCall code blocks', () => {
      const text = '```json:toolCall\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n```\n```json:toolCall\n{"name": "get_weather", "arguments": {"location": "Osaka"}}\n```';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].arguments).toEqual({ location: 'Tokyo' });
      expect(result.toolCalls[1].arguments).toEqual({ location: 'Osaka' });
    });

    it('should prefer special tokens over code blocks when both available', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          tool_call: {
            start: { text: '<tool_call>', id: 100 },
            end: { text: '</tool_call>', id: 101 }
          }
        },
        features: { apply_chat_template: true }
      } as MlxRuntimeInfo;

      // 特殊トークンで囲まれたtool callのみ検出される
      const text = '<tool_call>\n{"name": "fn_a", "arguments": {}}\n</tool_call>\n```json:toolCall\n{"name": "fn_b", "arguments": {}}\n```';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('fn_a');
    });
  });
});

describe('formatToolDefinitionsAsText', () => {
  it('should format tool definitions as text', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location']
        }
      }
    ];

    const result = formatToolDefinitionsAsText(tools);

    expect(result).toContain('## Available Tools');
    expect(result).toContain('### get_weather');
    expect(result).toContain('Get the weather for a location');
    expect(result).toContain('```json:toolCall');
    expect(result).toContain('"name": "tool_name"');
  });

  it('should use special tokens when tool_call tokens are available', () => {
    const tools: ToolDefinition[] = [{ name: 'test_fn', description: 'A test function' }];
    const specialTokens = {
      tool_call: {
        start: { text: '<tool_call>', id: 100 },
        end: { text: '</tool_call>', id: 101 }
      }
    };

    const result = formatToolDefinitionsAsText(tools, specialTokens);

    expect(result).toContain('<tool_call>');
    expect(result).toContain('</tool_call>');
    expect(result).not.toContain('```json:toolCall');
  });

  it('should handle tools without description or parameters', () => {
    const tools: ToolDefinition[] = [{ name: 'simple_tool' }];

    const result = formatToolDefinitionsAsText(tools);

    expect(result).toContain('### simple_tool');
    expect(result).not.toContain('undefined');
  });
});
