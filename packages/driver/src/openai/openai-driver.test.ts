import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIDriver } from './openai-driver.js';
import type { OpenAIQueryOptions } from './openai-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ToolDefinition } from '../types.js';

// Shared mock create function (hoisted for vi.mock factory)
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn()
}));

// Mock OpenAI module
vi.mock('openai', () => {
  mockCreate.mockImplementation((params) => {
    if (params.stream) {
      // Return an async iterable for streaming
      return (async function* () {
        yield {
          choices: [{
            delta: { content: 'Mocked' },
            finish_reason: null
          }]
        };
        yield {
          choices: [{
            delta: { content: ' response' },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15
          }
        };
      })();
    } else {
      // Return a promise for non-streaming
      return Promise.resolve({
        choices: [{
          message: { content: 'Mocked response' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      });
    }
  });

  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: (...args: unknown[]) => mockCreate(...args)
        }
      }
    }))
  };
});

describe('OpenAIDriver', () => {
  let driver: OpenAIDriver;
  
  beforeEach(() => {
    driver = new OpenAIDriver({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });
  });
  
  it('should initialize with config', () => {
    expect(driver).toBeDefined();
  });
  
  it('should query with a compiled prompt', async () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Test instruction' }
      ],
      data: [],
      output: []
    };
    
    const result = await driver.query(prompt);
    
    expect(result.content).toBe('Mocked response');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
  });
  
  it('should handle query options', async () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        { type: 'text', content: 'Some data' }
      ],
      output: []
    };
    
    const result = await driver.query(prompt, {
      temperature: 0.7,
      maxTokens: 100
    });
    
    expect(result.content).toBe('Mocked response');
  });
  
  describe('tools support', () => {
    const toolDefs: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            },
            required: ['location']
          }
        }
      }
    ];

    it('should pass tools and toolChoice to API params', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are helpful' }],
        data: [],
        output: []
      };

      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'auto'
      } as OpenAIQueryOptions);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: toolDefs,
          tool_choice: 'auto'
        })
      );
    });

    it('should not include tools in params when not specified', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      await driver.query(prompt);

      const calledParams = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
      expect(calledParams).not.toHaveProperty('tools');
      expect(calledParams).not.toHaveProperty('tool_choice');
    });

    it('should extract tool calls from stream response', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      OpenAI.mockImplementationOnce(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => {
              return (async function* () {
                // First chunk: tool call starts
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: 'call_abc123',
                        function: {
                          name: 'get_weather',
                          arguments: '{"loc'
                        }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                // Second chunk: tool call arguments continue
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        function: {
                          arguments: 'ation":"Tokyo"}'
                        }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                // Final chunk: finish reason
                yield {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls'
                  }],
                  usage: {
                    prompt_tokens: 20,
                    completion_tokens: 10,
                    total_tokens: 30
                  }
                };
              })();
            })
          }
        }
      }));

      const toolDriver = new OpenAIDriver({ apiKey: 'test-key' });
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const result = await toolDriver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'auto'
      } as OpenAIQueryOptions);

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_abc123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Tokyo"}'
        }
      });
    });

    it('should handle multiple tool calls', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      OpenAI.mockImplementationOnce(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => {
              return (async function* () {
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_1',
                          function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' }
                        },
                        {
                          index: 1,
                          id: 'call_2',
                          function: { name: 'get_weather', arguments: '{"location":"Osaka"}' }
                        }
                      ]
                    },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls'
                  }]
                };
              })();
            })
          }
        }
      }));

      const toolDriver = new OpenAIDriver({ apiKey: 'test-key' });
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const result = await toolDriver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'auto'
      } as OpenAIQueryOptions);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].id).toBe('call_1');
      expect(result.toolCalls![1].id).toBe('call_2');
    });

    it('should not include toolCalls when no tool calls in response', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const result = await driver.query(prompt);

      expect(result.toolCalls).toBeUndefined();
    });

    it('should pass toolChoice "none" to API params', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'none'
      } as OpenAIQueryOptions);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: 'none'
        })
      );
    });

    it('should pass toolChoice "required" to API params', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'required'
      } as OpenAIQueryOptions);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: 'required'
        })
      );
    });

    it('should pass specific function toolChoice to API params', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const specificChoice = { type: 'function' as const, function: { name: 'get_weather' } };
      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: specificChoice
      } as OpenAIQueryOptions);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: specificChoice
        })
      );
    });

    it('should use tools from defaultOptions', async () => {
      const toolDriver = new OpenAIDriver({
        apiKey: 'test-key',
        defaultOptions: {
          tools: toolDefs,
          toolChoice: 'auto'
        }
      });

      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      await toolDriver.query(prompt);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: toolDefs,
          tool_choice: 'auto'
        })
      );
    });

    it('should return empty content and toolCalls when response has only tool calls', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      OpenAI.mockImplementationOnce(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => {
              return (async function* () {
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: 'call_1',
                        function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls'
                  }]
                };
              })();
            })
          }
        }
      }));

      const toolDriver = new OpenAIDriver({ apiKey: 'test-key' });
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const result = await toolDriver.query(prompt);

      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should handle mixed text content and tool calls', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      OpenAI.mockImplementationOnce(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => {
              return (async function* () {
                // Text content
                yield {
                  choices: [{
                    delta: { content: 'Let me check ' },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: { content: 'the weather.' },
                    finish_reason: null
                  }]
                };
                // Tool call
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: 'call_mix',
                        function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls'
                  }]
                };
              })();
            })
          }
        }
      }));

      const toolDriver = new OpenAIDriver({ apiKey: 'test-key' });
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const result = await toolDriver.query(prompt);

      expect(result.content).toBe('Let me check the weather.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].function.name).toBe('get_weather');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should only yield text in stream, not tool call data', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      OpenAI.mockImplementationOnce(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => {
              return (async function* () {
                // Tool call only, no text content
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: 'call_stream',
                        function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls'
                  }]
                };
              })();
            })
          }
        }
      }));

      const toolDriver = new OpenAIDriver({ apiKey: 'test-key' });
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const { stream, result } = await toolDriver.streamQuery(prompt);

      // Stream should yield nothing (no text content)
      const streamChunks: string[] = [];
      for await (const chunk of stream) {
        streamChunks.push(chunk);
      }
      expect(streamChunks).toHaveLength(0);

      // Result should have tool calls
      const finalResult = await result;
      expect(finalResult.toolCalls).toHaveLength(1);
      expect(finalResult.content).toBe('');
    });

    it('should yield only text in stream when mixed with tool calls', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      OpenAI.mockImplementationOnce(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => {
              return (async function* () {
                yield {
                  choices: [{
                    delta: { content: 'Checking...' },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: 'call_mixed_stream',
                        function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls'
                  }]
                };
              })();
            })
          }
        }
      }));

      const toolDriver = new OpenAIDriver({ apiKey: 'test-key' });
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const { stream, result } = await toolDriver.streamQuery(prompt);

      // Stream should yield only text
      const streamChunks: string[] = [];
      for await (const chunk of stream) {
        streamChunks.push(chunk);
      }
      expect(streamChunks).toEqual(['Checking...']);

      // Result should have both text and tool calls
      const finalResult = await result;
      expect(finalResult.content).toBe('Checking...');
      expect(finalResult.toolCalls).toHaveLength(1);
    });

    it('should handle parallel tool calls across multiple chunks', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      OpenAI.mockImplementationOnce(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => {
              return (async function* () {
                // First chunk: both tool calls start
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [
                        { index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '{"city' } },
                        { index: 1, id: 'call_b', function: { name: 'get_time', arguments: '{"tz' } }
                      ]
                    },
                    finish_reason: null
                  }]
                };
                // Second chunk: arguments continue for both
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [
                        { index: 0, function: { arguments: '":"tokyo"}' } },
                        { index: 1, function: { arguments: '":"JST"}' } }
                      ]
                    },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls'
                  }]
                };
              })();
            })
          }
        }
      }));

      const toolDriver = new OpenAIDriver({ apiKey: 'test-key' });
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [],
        output: []
      };

      const result = await toolDriver.query(prompt);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_a',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"tokyo"}' }
      });
      expect(result.toolCalls![1]).toEqual({
        id: 'call_b',
        type: 'function',
        function: { name: 'get_time', arguments: '{"tz":"JST"}' }
      });
    });
  });

  it('should handle errors gracefully', async () => {
    // Create a driver that will throw an error
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    OpenAI.mockImplementationOnce(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params) => {
            if (params.stream) {
              // Return an async iterable that throws
              return (async function* () {
                yield; // Add yield to satisfy generator requirement
                throw new Error('API Error');
              })();
            } else {
              return Promise.reject(new Error('API Error'));
            }
          })
        }
      }
    }));

    const errorDriver = new OpenAIDriver({ apiKey: 'test-key' });
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'Test' }],
      data: [],
      output: []
    };

    const result = await errorDriver.query(prompt);

    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });

  describe('tool message elements', () => {
    it('should convert tool call and tool result messages to API format', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are helpful' }],
        data: [
          // アシスタントのtool call付きメッセージ
          {
            type: 'message',
            role: 'assistant',
            content: 'Let me check the weather',
            toolCalls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' }
            }]
          },
          // ツール実行結果
          {
            type: 'message',
            role: 'tool',
            content: '{"temp":25}',
            toolCallId: 'call_123',
            name: 'get_weather'
          }
        ],
        output: []
      };

      await driver.query(prompt);

      // APIに渡されたmessagesを検証
      const calledParams = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
      expect(calledParams.messages).toContainEqual(
        expect.objectContaining({
          role: 'assistant',
          content: 'Let me check the weather',
          tool_calls: expect.arrayContaining([
            expect.objectContaining({
              id: 'call_123',
              type: 'function',
              function: expect.objectContaining({
                name: 'get_weather',
                arguments: '{"city":"Tokyo"}'
              })
            })
          ])
        })
      );
      expect(calledParams.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          content: '{"temp":25}',
          tool_call_id: 'call_123'
        })
      );
    });
  });

});