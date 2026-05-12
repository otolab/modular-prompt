import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicDriver } from './anthropic-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ToolDefinition } from '../types.js';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn()
      }
    }))
  };
});

describe('AnthropicDriver', () => {
  let driver: AnthropicDriver;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new AnthropicDriver({ apiKey: 'test-key' });
    // Get the mock create function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockCreate = (driver as any).client.messages.create;
  });

  describe('structured outputs', () => {
    it('should add JSON instruction to system prompt when outputSchema is provided', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are a helpful assistant.' }],
        data: [{ type: 'text', content: 'Analyze this text and return JSON.' }],
        output: [],
        metadata: {
          outputSchema: {
            type: 'object',
            properties: {
              sentiment: { type: 'string' },
              score: { type: 'number' }
            }
          }
        }
      };

      // Mock streaming response
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"sentiment":' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '"positive","score":0.8}' } };
          yield { type: 'message_stop' };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt);

      // Verify the system prompt contains JSON instruction
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('You must respond with valid JSON')
        })
      );

      // Verify structured output is extracted
      expect(result.structuredOutput).toEqual({
        sentiment: 'positive',
        score: 0.8
      });
    });

    it('should extract JSON from markdown code blocks', async () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [{ type: 'text', content: 'Generate JSON' }],
        output: [],
        metadata: {
          outputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string' }
            }
          }
        }
      };

      // Mock response with markdown code block
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Here is the JSON:\n```json\n' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"status":"success"}' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '\n```' } };
          yield { type: 'message_stop' };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt);

      expect(result.structuredOutput).toEqual({
        status: 'success'
      });
    });

    it('should return undefined structuredOutput when no schema is provided', async () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [{ type: 'text', content: 'Hello' }],
        output: []
      };

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello there!' } };
          yield { type: 'message_stop' };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt);

      // Should not add JSON instruction
      const calledParams = mockCreate.mock.calls[0][0];
      expect(calledParams).not.toHaveProperty('system');

      expect(result.structuredOutput).toBeUndefined();
    });

    it('should handle invalid JSON gracefully', async () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [{ type: 'text', content: 'Generate something' }],
        output: [],
        metadata: {
          outputSchema: {
            type: 'object',
            properties: {
              data: { type: 'string' }
            }
          }
        }
      };

      // Mock response with invalid JSON
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'This is not JSON' } };
          yield { type: 'message_stop' };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt);

      expect(result.content).toBe('This is not JSON');
      expect(result.structuredOutput).toBeUndefined();
    });

    it('should work with streamQuery', async () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [{ type: 'text', content: 'Stream JSON' }],
        output: [],
        metadata: {
          outputSchema: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        }
      };

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"id":' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '123,' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '"name":"test"}' } };
          yield { type: 'message_stop' };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const { stream, result } = await driver.streamQuery(prompt);

      // Consume stream
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const finalResult = await result;

      expect(chunks.join('')).toBe('{"id":123,"name":"test"}');
      expect(finalResult.structuredOutput).toEqual({
        id: 123,
        name: 'test'
      });
    });
  });

  describe('tools', () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'You are a helpful assistant.' }],
      data: [{ type: 'text', content: 'What is the weather in Tokyo?' }],
      output: []
    };

    const toolDefs: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' }
          },
          required: ['location']
        }
      }
    ];

    it('should pass tools and toolChoice to API params', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 10 } } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(prompt, { tools: toolDefs, toolChoice: 'auto' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              name: 'get_weather',
              description: 'Get current weather for a location',
              input_schema: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' }
                },
                required: ['location']
              }
            }
          ],
          tool_choice: { type: 'auto' }
        })
      );
    });

    it('should not include tools in params when not specified', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(prompt);

      const calledParams = mockCreate.mock.calls[0][0];
      expect(calledParams).not.toHaveProperty('tools');
      expect(calledParams).not.toHaveProperty('tool_choice');
    });

    it('should extract tool calls from stream response', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 50 } } };
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_abc123', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"loc' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ation":"Tokyo"}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt, { tools: toolDefs });

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'toolu_abc123',
        name: 'get_weather',
        arguments: { location: 'Tokyo' }
      });
    });

    it('should handle multiple tool calls', async () => {
      const multiToolDefs: ToolDefinition[] = [
        ...toolDefs,
        {
          name: 'get_time',
          description: 'Get current time',
          parameters: {
            type: 'object',
            properties: {
              timezone: { type: 'string' }
            }
          }
        }
      ];

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 60 } } };
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"location":"Tokyo"}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_2', name: 'get_time' } };
          yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"timezone":"JST"}' } };
          yield { type: 'content_block_stop', index: 1 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt, { tools: multiToolDefs });

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].name).toBe('get_weather');
      expect(result.toolCalls![0].arguments).toEqual({ location: 'Tokyo' });
      expect(result.toolCalls![1].name).toBe('get_time');
      expect(result.toolCalls![1].arguments).toEqual({ timezone: 'JST' });
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should convert toolChoice "none"', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'No tools used.' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(prompt, { tools: toolDefs, toolChoice: 'none' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: { type: 'none' }
        })
      );
    });

    it('should convert toolChoice "required"', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_x', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"location":"Osaka"}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(prompt, { tools: toolDefs, toolChoice: 'required' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: { type: 'any' }
        })
      );
    });

    it('should convert toolChoice for specific function', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_y', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"location":"Kyoto"}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: { name: 'get_weather' }
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: { type: 'tool', name: 'get_weather' }
        })
      );
    });

    it('should use tools from defaultOptions', async () => {
      const toolDriver = new AnthropicDriver({
        apiKey: 'test-key',
        defaultOptions: { tools: toolDefs, toolChoice: 'auto' }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolMockCreate = (toolDriver as any).client.messages.create;

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
        }
      };
      toolMockCreate.mockResolvedValue(mockStream);

      await toolDriver.query(prompt);

      expect(toolMockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.any(Array),
          tool_choice: { type: 'auto' }
        })
      );
    });

    it('should return empty content and toolCalls when response has only tool calls', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 50 } } };
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_only', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"location":"Sapporo"}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 15 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt, { tools: toolDefs });

      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should handle mixed text content and tool calls', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 50 } } };
          yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check the weather.' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_mix', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"location":"Nagoya"}' } };
          yield { type: 'content_block_stop', index: 1 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 25 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt, { tools: toolDefs });

      expect(result.content).toBe('Let me check the weather.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].arguments).toEqual({ location: 'Nagoya' });
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should only yield text in stream, not tool call data', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_stream', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"location":"Fukuoka"}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const { stream, result } = await driver.streamQuery(prompt, { tools: toolDefs });

      const streamChunks: string[] = [];
      for await (const chunk of stream) {
        streamChunks.push(chunk);
      }

      expect(streamChunks).toHaveLength(0);

      const finalResult = await result;
      expect(finalResult.toolCalls).toHaveLength(1);
      expect(finalResult.toolCalls![0].name).toBe('get_weather');
    });

    it('should yield only text in stream when mixed with tool calls', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking...' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_mixed', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"location":"Sendai"}' } };
          yield { type: 'content_block_stop', index: 1 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const { stream, result } = await driver.streamQuery(prompt, { tools: toolDefs });

      const streamChunks: string[] = [];
      for await (const chunk of stream) {
        streamChunks.push(chunk);
      }

      expect(streamChunks).toEqual(['Checking...']);

      const finalResult = await result;
      expect(finalResult.toolCalls).toHaveLength(1);
      expect(finalResult.content).toBe('Checking...');
    });

    it('should handle tool call arguments split across multiple chunks', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_split', name: 'get_weather' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"location"' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Hiroshima"' } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 15 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt, { tools: toolDefs });

      expect(result.toolCalls![0].arguments).toEqual({ location: 'Hiroshima' });
    });

    it('should extract usage from message_start and message_delta', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 100 } } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt);

      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      });
    });

    it('should map max_tokens stop_reason to length finishReason', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Truncated...' } };
          yield { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 4096 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      const result = await driver.query(prompt);

      expect(result.finishReason).toBe('length');
    });

    it('should convert tool call and tool result messages to Anthropic API format', async () => {
      const toolPrompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are helpful' }],
        data: [
          // アシスタントのtool call付きメッセージ
          {
            type: 'message',
            role: 'assistant',
            content: 'Let me check the weather',
            toolCalls: [{
              id: 'call_123',
              name: 'get_weather',
              arguments: { city: 'Tokyo' }
            }]
          },
          // ツール実行結果
          {
            type: 'message',
            role: 'tool',
            toolCallId: 'call_123',
            name: 'get_weather',
            kind: 'data',
            value: { temp: 25 }
          }
        ],
        output: []
      };

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'The temperature is 25°C' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(toolPrompt);

      // APIに渡されたmessagesを検証
      const calledParams = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];

      // assistant message: content配列にtextとtool_useを含む
      const assistantMsg = calledParams.messages.find((m: { role: string }) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toBeInstanceOf(Array);
      expect(assistantMsg.content).toContainEqual(
        expect.objectContaining({ type: 'text', text: 'Let me check the weather' })
      );
      expect(assistantMsg.content).toContainEqual(
        expect.objectContaining({
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather',
          input: { city: 'Tokyo' }
        })
      );

      // tool result: role: 'user', content配列にtool_resultを含む
      const toolResultMsg = calledParams.messages.find(
        (m: { role: string; content: unknown[] }) =>
          m.role === 'user' && Array.isArray(m.content) &&
          m.content.some((c: unknown) => (c as { type: string }).type === 'tool_result')
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content).toContainEqual(
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'call_123',
          content: '{"temp":25}'
        })
      );
    });

    it('should convert tool result with error kind to Anthropic API format with is_error flag', async () => {
      const toolPrompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are helpful' }],
        data: [
          {
            type: 'message',
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: 'call_err',
              name: 'get_weather',
              arguments: { city: 'Tokyo' }
            }]
          },
          {
            type: 'message',
            role: 'tool',
            toolCallId: 'call_err',
            name: 'get_weather',
            kind: 'error',
            value: 'Connection timeout'
          }
        ],
        output: []
      };

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Error occurred' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(toolPrompt);

      const calledParams = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];

      // tool result: role: 'user', content配列にtool_resultを含む（is_error: true）
      const toolResultMsg = calledParams.messages.find(
        (m: { role: string; content: unknown[] }) =>
          m.role === 'user' && Array.isArray(m.content) &&
          m.content.some((c: unknown) => (c as { type: string }).type === 'tool_result')
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content).toContainEqual(
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'call_err',
          content: 'Connection timeout',
          is_error: true
        })
      );
    });
  });

  describe('prompt caching (cache option)', () => {
    it('cache=false: systemは文字列、cache_controlなし', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are helpful.' }],
        data: [{ type: 'text', content: 'Some data' }],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: false });
      expect(typeof result.system).toBe('string');
      expect(result.system).toBe('You are helpful.');
    });

    it('cache=true: systemがTextBlockParam[]になりcache_controlが付与される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are helpful.' }],
        data: [{ type: 'text', content: 'Some data' }],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      expect(Array.isArray(result.system)).toBe(true);
      const systemBlocks = result.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
      expect(systemBlocks[0].type).toBe('text');
      expect(systemBlocks[0].text).toBe('You are helpful.');
      expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('cache=true: MessageElementは常にキャッシュ対象として扱われる', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'message', role: 'user', content: 'Hello', cacheHint: 'contextual' },
          { type: 'message', role: 'assistant', content: 'Hi!' },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // messages配列にMessageが含まれる（キャッシュ対象部分）
      const userMsg = result.messages.find(m => m.content === 'Hello' || (Array.isArray(m.content) && m.content.some((c: { text?: string }) => c.text === 'Hello')));
      expect(userMsg).toBeDefined();
    });

    it('cache=true: キャッシュ対象の最後のuserメッセージにcache_controlが付き、recentMessageはcueに配置される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'message', role: 'user', content: 'First question' },
          { type: 'message', role: 'assistant', content: 'First answer' },
          { type: 'message', role: 'user', content: 'Second question' },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // recentMessage（Second question）はcacheableから除外され、cueに配置される
      // cache_controlはcacheable部分の最後のuserメッセージ（First question）に付く
      const cachedMsg = result.messages.find(m =>
        Array.isArray(m.content) &&
        m.content.some((c: { text?: string; cache_control?: unknown }) => c.text === 'First question' && c.cache_control)
      );
      expect(cachedMsg).toBeDefined();

      // Second questionはcueとして末尾に存在する（cache_controlなし）
      const lastUserMsg = [...result.messages].reverse().find(m => m.role === 'user');
      expect(typeof lastUserMsg?.content).toBe('string');
      expect(lastUserMsg?.content).toBe('Second question');
    });

    it('cache=true: cacheHint=contextualなセクションはキャッシュ対象外', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'message', role: 'user', content: 'Hello' },
          {
            type: 'section',
            category: 'data',
            title: 'Current State',
            items: ['state data here'],
            cacheHint: 'contextual'
          },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // 'Hello'が唯一のuserメッセージかつrecentMessageなので、cueに配置される
      // cacheableは空のため、userメッセージにcache_controlは付かない
      // stateはcacheHint=contextualのため非キャッシュ領域に配置される
      const stateMsg = result.messages.find(m =>
        typeof m.content === 'string' && m.content.includes('Current State')
      );
      expect(stateMsg).toBeDefined();

      // Helloはcueとして存在する
      const helloMsg = result.messages.find(m =>
        typeof m.content === 'string' && m.content === 'Hello'
      );
      expect(helloMsg).toBeDefined();

      // systemにはcache_controlが付いている
      expect(Array.isArray(result.system)).toBe(true);
      const systemBlocks = result.system as Array<{ cache_control?: unknown }>;
      expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('cache=true: chunksはキャッシュ対象外', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'material', id: 'doc1', title: 'Doc', content: 'content', cacheHint: 'static' },
          { type: 'chunk', partOf: 'input', content: 'chunk data', cacheHint: 'contextual' },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // materialはキャッシュ対象、chunkはキャッシュ対象外
      // messagesの中にmaterialとchunkが別々に配置される
      expect(result.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('cache=true: recentMessageがcueとして再掲される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'message', role: 'user', content: 'Question' },
          { type: 'message', role: 'assistant', content: 'Answer' },
          { type: 'message', role: 'user', content: 'Follow-up' },
        ],
        output: [
          { type: 'section', category: 'output', title: 'Output', items: ['Respond concisely.'] }
        ]
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // output指示とrecentMessageがmessagesに含まれる
      const allContent = result.messages
        .filter(m => m.role === 'user')
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .join(' ');
      expect(allContent).toContain('Follow-up');
      expect(allContent).toContain('Output');
    });

    it('cache=true: recentMessageがcacheableとcueで重複しない', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'message', role: 'user', content: 'First' },
          { type: 'message', role: 'assistant', content: 'Reply' },
          { type: 'message', role: 'user', content: 'Second' },
        ],
        output: [
          { type: 'section', category: 'output', title: 'Output', items: ['Respond.'] }
        ]
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      const userContents = result.messages
        .filter(m => m.role === 'user')
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      const secondCount = userContents.filter(c => c === 'Second').length;
      expect(secondCount).toBe(1);
    });

    it('cache=true: cacheHint=contextualな動的セクション（非state/chunks）もキャッシュ対象外', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'material', id: 'doc1', title: 'Doc', content: 'static doc', cacheHint: 'static' },
          {
            type: 'section',
            category: 'data',
            title: 'Dynamic Guide',
            items: ['dynamically generated content'],
            cacheHint: 'contextual'
          },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // materialはキャッシュ対象（cache_control付き）
      const cachedMsg = result.messages.find(m =>
        Array.isArray(m.content) &&
        m.content.some((c: { cache_control?: unknown }) => c.cache_control)
      );
      expect(cachedMsg).toBeDefined();

      // Dynamic Guideセクションはキャッシュブレークポイントの後に配置される
      const dynamicMsg = result.messages.find(m =>
        typeof m.content === 'string' && m.content.includes('Dynamic Guide')
      );
      expect(dynamicMsg).toBeDefined();
    });

    it('cache=true: output内のsystem roleメッセージがsystemに反映される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Base' }],
        data: [{ type: 'text', content: 'Data' }],
        output: [
          { type: 'message', role: 'system', content: 'System context from output' },
          { type: 'text', content: 'Respond now.' },
        ]
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      const systemText = Array.isArray(result.system)
        ? result.system.map(b => b.text).join('\n')
        : result.system;
      expect(systemText).toContain('System context from output');
    });

    it('cache=true: recentMessageはuserメッセージのみ追跡される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'message', role: 'user', content: 'Question' },
          { type: 'message', role: 'assistant', content: 'Last assistant message' },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // assistantメッセージはcueとして再掲されない
      const userMessages = result.messages.filter(m => m.role === 'user');
      const hasAssistantAsCue = userMessages.some(m =>
        typeof m.content === 'string' && m.content.includes('Last assistant message')
      );
      expect(hasAssistantAsCue).toBe(false);
    });

    it('cache=true: メッセージ交互制約が維持される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [
          { type: 'message', role: 'assistant', content: 'Proactive message' },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      // 最初のメッセージがassistantの場合、先頭にuserが追加される
      expect(result.messages[0].role).toBe('user');
    });

    it('cache=true: outputSchemaがある場合もsystemにcache_controlが付く', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Analyze.' }],
        data: [{ type: 'text', content: 'Data' }],
        output: [],
        metadata: { outputSchema: { type: 'object', properties: { result: { type: 'string' } } } }
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      const systemBlocks = result.system as Array<{ type: string; text: string; cache_control?: { type: string } }>;
      expect(systemBlocks[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(systemBlocks[0].text).toContain('JSON');
    });

    it('cache=true: dataにsystem roleのMessageElementがある場合もsystemに反映される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Base instructions' }],
        data: [
          { type: 'message', role: 'system', content: 'Additional system context from dialogue' },
          { type: 'message', role: 'user', content: 'Hello' },
        ],
        output: []
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      const systemText = Array.isArray(result.system)
        ? result.system.map(b => b.text).join('\n')
        : result.system;
      expect(systemText).toContain('Additional system context from dialogue');
    });

    it('cache=true: outputにMessageElementが含まれる場合もmessagesに変換される', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'System' }],
        data: [{ type: 'text', content: 'Data' }],
        output: [
          { type: 'message', role: 'user', content: 'Please respond to this specific task' },
        ]
      };

      const result = driver.compiledPromptToAnthropic(prompt, { cache: true });
      const allContent = result.messages
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .join(' ');
      expect(allContent).toContain('Please respond to this specific task');
    });
  });

  describe('element order preservation', () => {
    it('should preserve element order when SectionElement precedes MessageElements', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are helpful' }],
        data: [
          {
            type: 'section',
            category: 'data',
            title: 'Context',
            items: ['Background info']
          },
          {
            type: 'message',
            role: 'user',
            content: 'Question 1'
          },
          {
            type: 'message',
            role: 'assistant',
            content: 'Answer 1'
          }
        ],
        output: []
      };

      await driver.query(prompt);

      const calledParams = mockCreate.mock.calls[0][0];

      // SectionElement のテキストが MessageElements より前にあること
      expect(calledParams.messages[0]).toEqual(
        expect.objectContaining({ role: 'user', content: expect.stringContaining('Context') })
      );
      expect(calledParams.messages[1]).toEqual(
        expect.objectContaining({ role: 'user', content: 'Question 1' })
      );
      expect(calledParams.messages[2]).toEqual(
        expect.objectContaining({ role: 'assistant', content: 'Answer 1' })
      );
    });

    it('should preserve order when text and messages are interleaved', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const prompt: CompiledPrompt = {
        instructions: [],
        data: [
          { type: 'text', content: 'Text A' },
          { type: 'message', role: 'user', content: 'Message B' },
          { type: 'text', content: 'Text C' },
          { type: 'message', role: 'assistant', content: 'Message D' }
        ],
        output: []
      };

      await driver.query(prompt);

      const calledParams = mockCreate.mock.calls[0][0];
      const messages = calledParams.messages;

      // Text A → Message B → Text C → Message D の順序が保持されること
      expect(messages[0]).toEqual(
        expect.objectContaining({ role: 'user', content: 'Text A' })
      );
      expect(messages[1]).toEqual(
        expect.objectContaining({ role: 'user', content: 'Message B' })
      );
      expect(messages[2]).toEqual(
        expect.objectContaining({ role: 'user', content: 'Text C' })
      );
      expect(messages[3]).toEqual(
        expect.objectContaining({ role: 'assistant', content: 'Message D' })
      );
    });
  });

});