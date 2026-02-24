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

  describe('pythonic形式 (tool_call_start/end)', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_call_explicit: {
          start: { text: '<|tool_call_start|>', id: 200 },
          end: { text: '<|tool_call_end|>', id: 201 }
        }
      },
      features: { apply_chat_template: true }
    } as MlxRuntimeInfo;

    it('should detect tool call with pythonic delimiters', () => {
      const text = 'Let me check.\n<|tool_call_start|>\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n<|tool_call_end|>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.content).toBe('Let me check.');
    });
  });

  describe('function_gemma形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        function_call_tags: {
          start: { text: '<start_function_call>', id: 300 },
          end: { text: '<end_function_call>', id: 301 }
        }
      },
      features: { apply_chat_template: true }
    } as MlxRuntimeInfo;

    it('should detect tool call with function_gemma delimiters', () => {
      const text = '<start_function_call>\n{"name": "search", "arguments": {"query": "test"}}\n<end_function_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
    });
  });

  describe('Mistral形式 ([TOOL_CALLS] マーカー)', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_calls_marker: { text: '[TOOL_CALLS]', id: 400 }
      },
      features: { apply_chat_template: true }
    } as MlxRuntimeInfo;

    it('should detect tool call after [TOOL_CALLS] marker', () => {
      const text = 'I will search for you.[TOOL_CALLS] {"name": "search", "arguments": {"query": "weather"}}';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.content).toBe('I will search for you.');
    });

    it('should detect array of tool calls after marker', () => {
      const text = '[TOOL_CALLS] [{"name": "fn_a", "arguments": {}}, {"name": "fn_b", "arguments": {"x": 1}}]';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('fn_a');
      expect(result.toolCalls[1].name).toBe('fn_b');
    });
  });

  describe('tool_parser_type からの逆引き検出', () => {
    it('should detect tool call via tool_parser_type=pythonic', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {},
        features: {
          apply_chat_template: true,
          chat_template: {
            supported_roles: ['user', 'assistant'],
            constraints: {},
            tool_call_format: {
              tool_parser_type: 'pythonic'
            }
          }
        }
      } as MlxRuntimeInfo;

      const text = '<|tool_call_start|>\n{"name": "calc", "arguments": {"x": 5}}\n<|tool_call_end|>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('calc');
    });

    it('should detect tool call via tool_parser_type=json_tools', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {},
        features: {
          apply_chat_template: true,
          chat_template: {
            supported_roles: ['user', 'assistant'],
            constraints: {},
            tool_call_format: {
              tool_parser_type: 'json_tools'
            }
          }
        }
      } as MlxRuntimeInfo;

      const text = '<tool_call>\n{"name": "search", "arguments": {"q": "test"}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
    });
  });

  describe('kimi_k2形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_calls_section: {
          start: { text: '<|tool_calls_section_begin|>', id: 500 },
          end: { text: '<|tool_calls_section_end|>', id: 501 }
        }
      },
      features: { apply_chat_template: true }
    } as MlxRuntimeInfo;

    it('should detect tool call with kimi_k2 delimiters', () => {
      const text = '<|tool_calls_section_begin|>\n{"name": "lookup", "arguments": {"id": 42}}\n<|tool_calls_section_end|>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('lookup');
      expect(result.toolCalls[0].arguments).toEqual({ id: 42 });
    });
  });

  describe('longcat形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        longcat_tool_call: {
          start: { text: '<longcat_tool_call>', id: 600 },
          end: { text: '</longcat_tool_call>', id: 601 }
        }
      },
      features: { apply_chat_template: true }
    } as MlxRuntimeInfo;

    it('should detect tool call with longcat delimiters', () => {
      const text = '<longcat_tool_call>\n{"name": "fetch", "arguments": {"url": "https://example.com"}}\n</longcat_tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('fetch');
    });
  });

  describe('minimax形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        minimax_tool_call: {
          start: { text: '<minimax:tool_call>', id: 700 },
          end: { text: '</minimax:tool_call>', id: 701 }
        }
      },
      features: { apply_chat_template: true }
    } as MlxRuntimeInfo;

    it('should detect tool call with minimax delimiters', () => {
      const text = '<minimax:tool_call>\n{"name": "translate", "arguments": {"text": "hello", "to": "ja"}}\n</minimax:tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('translate');
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

  it('should format parameters as concise list when properties exist', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search for items',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number' }
          },
          required: ['query']
        }
      }
    ];

    const result = formatToolDefinitionsAsText(tools);

    expect(result).toContain('- query: string (required): Search query');
    expect(result).toContain('- limit: number');
    // JSON形式ではなくリスト形式で出力される
    expect(result).not.toContain('"type":"object"');
  });

  it('should use toolCallFormat delimiters when provided', () => {
    const tools: ToolDefinition[] = [{ name: 'test_fn' }];
    const result = formatToolDefinitionsAsText(tools, undefined, {
      call_start: '<|tool_call_start|>',
      call_end: '<|tool_call_end|>'
    });

    expect(result).toContain('<|tool_call_start|>');
    expect(result).toContain('<|tool_call_end|>');
  });
});
