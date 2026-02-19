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
        type: 'function',
        function: {
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
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Tokyo"}'
        }
      });
    });

    it('should handle multiple tool calls', async () => {
      const multiToolDefs: ToolDefinition[] = [
        ...toolDefs,
        {
          type: 'function',
          function: {
            name: 'get_time',
            description: 'Get current time',
            parameters: {
              type: 'object',
              properties: {
                timezone: { type: 'string' }
              }
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
      expect(result.toolCalls![0].function.name).toBe('get_weather');
      expect(result.toolCalls![0].function.arguments).toBe('{"location":"Tokyo"}');
      expect(result.toolCalls![1].function.name).toBe('get_time');
      expect(result.toolCalls![1].function.arguments).toBe('{"timezone":"JST"}');
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
        toolChoice: { type: 'function', function: { name: 'get_weather' } }
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
      expect(result.toolCalls![0].function.arguments).toBe('{"location":"Nagoya"}');
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
      expect(finalResult.toolCalls![0].function.name).toBe('get_weather');
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

      expect(result.toolCalls![0].function.arguments).toBe('{"location":"Hiroshima"}');
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
  });

  describe('options.messages', () => {
    const basicPrompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'You are helpful' }],
      data: [],
      output: []
    };

    it('should append tool result messages to API params', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'The weather is sunny' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(basicPrompt, {
        messages: [
          {
            role: 'assistant',
            content: 'Let me check',
            toolCalls: [{
              id: 'toolu_abc',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' }
            }]
          },
          {
            role: 'tool',
            content: '{"temp":15}',
            toolCallId: 'toolu_abc'
          }
        ]
      });

      const calledParams = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
      expect(calledParams.messages).toHaveLength(3); // user (from prompt) + assistant + user (tool result)

      // Check assistant message with tool use
      const assistantMsg = calledParams.messages[1];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toHaveLength(2);
      expect(assistantMsg.content[0]).toEqual({ type: 'text', text: 'Let me check' });
      expect(assistantMsg.content[1].type).toBe('tool_use');
      expect(assistantMsg.content[1].id).toBe('toolu_abc');
      expect(assistantMsg.content[1].name).toBe('get_weather');

      // Check tool result message
      const toolResultMsg = calledParams.messages[2];
      expect(toolResultMsg.role).toBe('user');
      expect(toolResultMsg.content).toHaveLength(1);
      expect(toolResultMsg.content[0].type).toBe('tool_result');
      expect(toolResultMsg.content[0].tool_use_id).toBe('toolu_abc');
      expect(toolResultMsg.content[0].content).toBe('{"temp":15}');
    });

    it('should work correctly when messages is not specified', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
        }
      };
      mockCreate.mockResolvedValue(mockStream);

      await driver.query(basicPrompt);

      const calledParams = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
      // Should only have the message from prompt
      expect(calledParams.messages).toHaveLength(1);
    });
  });
});