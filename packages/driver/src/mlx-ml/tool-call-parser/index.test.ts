import { describe, it, expect } from 'vitest';
import { parseToolCalls } from './index.js';
import type { MlxRuntimeInfo } from '../process/types.js';

describe('parseToolCalls', () => {
  describe('特殊トークンによる検出', () => {
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

    it('should detect single tool call with delimiters', () => {
      const text = 'Let me check the weather.\n<tool_call>\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_0',
        name: 'get_weather',
        arguments: { location: 'Tokyo' },
      });
      expect(result.content).toBe('Let me check the weather.');
    });

    it('should detect multiple tool calls', () => {
      const text = '<tool_call>\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n</tool_call>\n<tool_call>\n{"name": "get_weather", "arguments": {"location": "Osaka"}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].id).toBe('call_0');
      expect(result.toolCalls[1].id).toBe('call_1');
    });

    it('should skip invalid JSON inside delimiters', () => {
      const text = '<tool_call>\nnot valid json\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return original text when no tool calls found', () => {
      const text = 'Just a regular response.';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.content).toBe(text);
    });
  });

  describe('汎用フォールバック', () => {
    it('should detect tool call from JSON pattern without runtimeInfo', () => {
      const text = '{"name": "get_weather", "arguments": {"location": "Tokyo"}}';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
    });

    it('should detect tool call with preceding text', () => {
      const text = 'I will check the weather.\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.content).toBe('I will check the weather.');
    });

    it('should return no tool calls for regular text', () => {
      const text = 'This is just a normal response.';
      const result = parseToolCalls(text, null);
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  describe('json:toolCallコードブロック検出', () => {
    it('should detect tool call in code block', () => {
      const text = 'Let me check.\n```json:toolCall\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n```';
      const result = parseToolCalls(text, null);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.content).toBe('Let me check.');
    });

    it('should detect multiple code blocks', () => {
      const text = '```json:toolCall\n{"name": "fn_a", "arguments": {}}\n```\n```json:toolCall\n{"name": "fn_b", "arguments": {}}\n```';
      const result = parseToolCalls(text, null);
      expect(result.toolCalls).toHaveLength(2);
    });

    it('should prefer special tokens over code blocks', () => {
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

      const text = '<tool_call>\n{"name": "fn_a", "arguments": {}}\n</tool_call>\n```json:toolCall\n{"name": "fn_b", "arguments": {}}\n```';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('fn_a');
    });
  });

  describe('pythonic形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_call_explicit: {
          start: { text: '<|tool_call_start|>', id: 200 },
          end: { text: '<|tool_call_end|>', id: 201 },
        },
      },
      features: { apply_chat_template: true },
    } as MlxRuntimeInfo;

    it('should detect JSON inside pythonic delimiters', () => {
      const text = 'Let me check.\n<|tool_call_start|>\n{"name": "get_weather", "arguments": {"location": "Tokyo"}}\n<|tool_call_end|>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.content).toBe('Let me check.');
    });

    it('should parse pythonic content format', () => {
      const text = '<|tool_call_start|>[get_weather(location="東京")]<|tool_call_end|>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_0',
        name: 'get_weather',
        arguments: { location: '東京' },
      });
    });
  });

  describe('function_gemma形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        function_call_tags: {
          start: { text: '<start_function_call>', id: 300 },
          end: { text: '<end_function_call>', id: 301 },
        },
      },
      features: { apply_chat_template: true },
    } as MlxRuntimeInfo;

    it('should detect tool call with function_gemma delimiters', () => {
      const text = '<start_function_call>\n{"name": "search", "arguments": {"query": "test"}}\n<end_function_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
    });
  });

  describe('Mistral形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {
        tool_calls_marker: { text: '[TOOL_CALLS]', id: 400 },
      },
      features: { apply_chat_template: true },
    } as MlxRuntimeInfo;

    it('should detect tool call after marker', () => {
      const text = 'I will search.[TOOL_CALLS] {"name": "search", "arguments": {"query": "weather"}}';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.content).toBe('I will search.');
    });

    it('should detect array of tool calls after marker', () => {
      const text = '[TOOL_CALLS] [{"name": "fn_a", "arguments": {}}, {"name": "fn_b", "arguments": {"x": 1}}]';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(2);
    });
  });

  describe('tool_parser_type逆引き', () => {
    it('should detect via tool_parser_type=pythonic', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {},
        features: {
          apply_chat_template: true,
          chat_template: {
            supported_roles: ['user', 'assistant'],
            constraints: {},
            tool_call_format: { tool_parser_type: 'pythonic' },
          },
        },
      } as MlxRuntimeInfo;

      const text = '<|tool_call_start|>\n{"name": "calc", "arguments": {"x": 5}}\n<|tool_call_end|>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('calc');
    });

    it('should detect via tool_parser_type=json_tools', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {},
        features: {
          apply_chat_template: true,
          chat_template: {
            supported_roles: ['user', 'assistant'],
            constraints: {},
            tool_call_format: { tool_parser_type: 'json_tools' },
          },
        },
      } as MlxRuntimeInfo;

      const text = '<tool_call>\n{"name": "search", "arguments": {"q": "test"}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
    });
  });

  describe('各種デリミタ形式', () => {
    it('kimi_k2', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          tool_calls_section: {
            start: { text: '<|tool_calls_section_begin|>', id: 500 },
            end: { text: '<|tool_calls_section_end|>', id: 501 },
          },
        },
        features: { apply_chat_template: true },
      } as MlxRuntimeInfo;

      const text = '<|tool_calls_section_begin|>\n{"name": "lookup", "arguments": {"id": 42}}\n<|tool_calls_section_end|>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('lookup');
    });

    it('longcat', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          longcat_tool_call: {
            start: { text: '<longcat_tool_call>', id: 600 },
            end: { text: '</longcat_tool_call>', id: 601 },
          },
        },
        features: { apply_chat_template: true },
      } as MlxRuntimeInfo;

      const text = '<longcat_tool_call>\n{"name": "fetch", "arguments": {"url": "https://example.com"}}\n</longcat_tool_call>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('fetch');
    });

    it('minimax', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          minimax_tool_call: {
            start: { text: '<minimax:tool_call>', id: 700 },
            end: { text: '</minimax:tool_call>', id: 701 },
          },
        },
        features: { apply_chat_template: true },
      } as MlxRuntimeInfo;

      const text = '<minimax:tool_call>\n{"name": "translate", "arguments": {"text": "hello", "to": "ja"}}\n</minimax:tool_call>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('translate');
    });
  });

  describe('XMLコンテンツ形式', () => {
    it('should parse qwen3_coder XML inside delimiters', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          tool_call_xml: {
            start: { text: '<tool_call>', id: 100 },
            end: { text: '</tool_call>', id: 101 },
          },
        },
        features: { apply_chat_template: true },
      } as MlxRuntimeInfo;

      const text = '<tool_call>\n<function=get_weather><parameter=location>Tokyo</parameter><parameter=unit>celsius</parameter></function>\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].arguments).toEqual({ location: 'Tokyo', unit: 'celsius' });
    });

    it('should parse hyphenated function name with surrounding tags', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          tool_call_xml: {
            start: { text: '<tool_call>', id: 248058 },
            end: { text: '</tool_call>', id: 248059 },
          },
        },
        features: {
          apply_chat_template: true,
          chat_template: {
            supported_roles: ['system', 'user', 'assistant', 'tool'],
            constraints: {},
            tool_call_format: { call_start: '<tool_call>', call_end: '</tool_call>' },
          },
        },
      } as MlxRuntimeInfo;

      const text = '確認します。\n</think>\n\nオペレータのステータスを確認します。\n\n<tool_call>\n<function=mcp__coeiro-operator__operator_status>\n</function>\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('mcp__coeiro-operator__operator_status');
      expect(result.content).toContain('オペレータのステータスを確認します');
    });

    it('should parse minimax invoke XML inside delimiters', () => {
      const runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          minimax_tool_call: {
            start: { text: '<minimax:tool_call>', id: 700 },
            end: { text: '</minimax:tool_call>', id: 701 },
          },
        },
        features: { apply_chat_template: true },
      } as MlxRuntimeInfo;

      const text = '<minimax:tool_call>\n<invoke name="get_weather"><parameter name="location">Tokyo</parameter></invoke>\n</minimax:tool_call>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].arguments).toEqual({ location: 'Tokyo' });
    });
  });

  describe('複数JSONスキーマ対応', () => {
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

    it('should parse nested function format', () => {
      const text = '<tool_call>\n{"function": {"name": "get_weather", "arguments": {"location": "Tokyo"}}}\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
    });

    it('should parse array inside delimiters', () => {
      const text = '<tool_call>\n[{"name": "fn_a", "arguments": {}}, {"name": "fn_b", "arguments": {"x": 1}}]\n</tool_call>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(2);
    });
  });

  describe('Gemma 4形式', () => {
    const runtimeInfo = {
      methods: ['chat'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
        chat_template: {
          supported_roles: ['system', 'user', 'assistant'],
          constraints: {},
          tool_call_format: {
            call_start: '<|tool_call>',
            call_end: '<tool_call|>',
          },
        },
      },
    } as MlxRuntimeInfo;

    it('should detect with special quote tokens', () => {
      const text = '<|tool_call>call:get_weather{location:<|"|>東京<|"|>}<tool_call|>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_0',
        name: 'get_weather',
        arguments: { location: '東京' },
      });
    });

    it('should handle multiple tool calls', () => {
      const text = '<|tool_call>call:fn_a{x:1}<tool_call|><|tool_call>call:fn_b{y:<|"|>test<|"|>}<tool_call|>';
      const result = parseToolCalls(text, runtimeInfo);
      expect(result.toolCalls).toHaveLength(2);
    });

    it('should extract content before tool call', () => {
      const text = '天気を確認します。\n<|tool_call>call:get_weather{location:<|"|>東京<|"|>}<tool_call|>';
      const result = parseToolCalls(text, runtimeInfo);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.content).toBe('天気を確認します。');
    });
  });
});
