import { describe, it, expect, vi } from 'vitest';
import { OllamaDriver } from './ollama-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ToolDefinition } from '../types.js';

// Shared mock create function (hoisted for vi.mock factory)
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn()
}));

// Mock OpenAI module (OllamaDriver uses OpenAI SDK internally)
vi.mock('openai', () => {
  mockCreate.mockImplementation(() => {
    return (async function* () {
      yield {
        choices: [{
          delta: { content: 'Ollama response' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12
        }
      };
    })();
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

describe('OllamaDriver', () => {
  const toolDefs: ToolDefinition[] = [
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

  const prompt: CompiledPrompt = {
    instructions: [{ type: 'text', content: 'Test' }],
    data: [],
    output: []
  };

  describe('initialization', () => {
    it('should use default Ollama settings', () => {
      const driver = new OllamaDriver();
      expect(driver).toBeDefined();
    });

    it('should accept custom baseURL and model', () => {
      const driver = new OllamaDriver({
        baseURL: 'http://custom:11434/v1',
        model: 'mistral'
      });
      expect(driver).toBeDefined();
    });
  });

  describe('tools support (inherited from OpenAIDriver)', () => {
    it('should pass tools and toolChoice to API params', async () => {
      const driver = new OllamaDriver();

      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'auto'
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [{
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the weather for a location',
              parameters: {
                type: 'object',
                properties: { location: { type: 'string' } },
                required: ['location']
              }
            }
          }],
          tool_choice: 'auto'
        })
      );
    });

    it('should pass toolChoice "required" to API params', async () => {
      const driver = new OllamaDriver();

      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'required'
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: 'required'
        })
      );
    });

    it('should extract tool calls from stream response', async () => {
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
                        id: 'call_ollama_1',
                        function: { name: 'get_weather', arguments: '{"loc' }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                yield {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        function: { arguments: 'ation":"Osaka"}' }
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

      const driver = new OllamaDriver();
      const result = await driver.query(prompt, { tools: toolDefs });

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_ollama_1',
        name: 'get_weather',
        arguments: { location: 'Osaka' }
      });
    });

    it('should only yield text in stream, not tool call data', async () => {
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
                        id: 'call_ollama_stream',
                        function: { name: 'get_weather', arguments: '{"location":"Kyoto"}' }
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

      const driver = new OllamaDriver();
      const { stream, result } = await driver.streamQuery(prompt, { tools: toolDefs });

      const streamChunks: string[] = [];
      for await (const chunk of stream) {
        streamChunks.push(chunk);
      }
      expect(streamChunks).toEqual(['Checking...']);

      const finalResult = await result;
      expect(finalResult.content).toBe('Checking...');
      expect(finalResult.toolCalls).toHaveLength(1);
    });

    it('should use tools from defaultOptions', async () => {
      const driver = new OllamaDriver({
        defaultOptions: {
          tools: toolDefs,
          toolChoice: 'auto'
        }
      });

      await driver.query(prompt);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [{
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the weather for a location',
              parameters: {
                type: 'object',
                properties: { location: { type: 'string' } },
                required: ['location']
              }
            }
          }],
          tool_choice: 'auto'
        })
      );
    });
  });
});
