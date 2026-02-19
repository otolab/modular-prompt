import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleGenAIDriver } from './google-genai-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ToolDefinition } from '../types.js';

// Mock @google/genai
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'Test response',  // convenience property
            candidates: [{
              finishReason: 'STOP'
            }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 20,
              totalTokenCount: 30
            }
          }),
          generateContentStream: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {
              yield { text: 'Hello', candidates: [{ finishReason: 'STOP' }] };
              yield { text: ' ', candidates: [{ finishReason: 'STOP' }] };
              yield { text: 'World', candidates: [{ finishReason: 'STOP' }] };
            },
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 20,
              totalTokenCount: 30
            }
          })
        }
      };
    }),
    FunctionCallingConfigMode: {
      MODE_UNSPECIFIED: 'MODE_UNSPECIFIED',
      AUTO: 'AUTO',
      ANY: 'ANY',
      NONE: 'NONE',
      VALIDATED: 'VALIDATED',
    }
  };
});

describe('GoogleGenAIDriver', () => {
  let driver: GoogleGenAIDriver;

  beforeEach(() => {
    driver = new GoogleGenAIDriver({
      apiKey: 'test-api-key',
      model: 'gemma-3-27b'
    });
  });

  describe('constructor', () => {
    it('should throw error if API key is not provided', () => {
      // Remove environment variable for this test
      const originalKey = process.env.GOOGLE_GENAI_API_KEY;
      delete process.env.GOOGLE_GENAI_API_KEY;

      expect(() => new GoogleGenAIDriver({})).toThrow(
        'GoogleGenAI API key is required'
      );

      // Restore environment variable
      if (originalKey) {
        process.env.GOOGLE_GENAI_API_KEY = originalKey;
      }
    });

    it('should use environment variable if API key is not in config', () => {
      process.env.GOOGLE_GENAI_API_KEY = 'env-api-key';

      expect(() => new GoogleGenAIDriver({})).not.toThrow();

      delete process.env.GOOGLE_GENAI_API_KEY;
    });

    it('should use default model if not specified', () => {
      const driver = new GoogleGenAIDriver({ apiKey: 'test-key' });
      expect(driver).toBeDefined();
    });
  });

  describe('query', () => {
    it('should execute basic query successfully', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are a helpful assistant.' }],
        data: [{ type: 'text', content: 'Hello!' }],
        output: []
      };

      const result = await driver.query(prompt);

      expect(result.content).toBe('Test response');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      });
    });

    it('should handle structured output', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Generate JSON' }],
        data: [],
        output: [],
        metadata: {
          outputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            }
          }
        }
      };

      const result = await driver.query(prompt);

      expect(result.content).toBeDefined();
      expect(result.finishReason).toBe('stop');
    });

    it('should handle errors gracefully', async () => {
      const errorDriver = new GoogleGenAIDriver({
        apiKey: 'test-api-key'
      });

      // Mock error
      vi.spyOn(errorDriver['client'].models, 'generateContent').mockRejectedValue(
        new Error('API Error')
      );

      const prompt: CompiledPrompt = {
        instructions: [],
        data: [],
        output: []
      };

      const result = await errorDriver.query(prompt);

      expect(result.content).toBe('');
      expect(result.finishReason).toBe('error');
    });
  });

  describe('streamQuery', () => {
    it('should stream response chunks', async () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'You are a helpful assistant.' }],
        data: [{ type: 'text', content: 'Hello!' }],
        output: []
      };

      const { stream, result } = await driver.streamQuery(prompt);

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' ', 'World']);

      const finalResult = await result;
      expect(finalResult.content).toBe('Hello World');
      expect(finalResult.finishReason).toBe('stop');
    });

    it('should provide final result with usage stats', async () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [{ type: 'text', content: 'Test' }],
        output: []
      };

      const { result } = await driver.streamQuery(prompt);
      const finalResult = await result;

      expect(finalResult.content).toBeDefined();
      expect(finalResult.finishReason).toBeDefined();
    });
  });

  describe('close', () => {
    it('should close without errors', async () => {
      await expect(driver.close()).resolves.not.toThrow();
    });
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

    const basicPrompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'You are helpful' }],
      data: [{ type: 'text', content: 'What is the weather?' }],
      output: []
    };

    it('should pass tools and toolConfig to API config', async () => {
      const mockGenerateContent = driver['client'].models.generateContent as ReturnType<typeof vi.fn>;

      await driver.query(basicPrompt, {
        tools: toolDefs,
        toolChoice: 'auto'
      });

      const callArgs = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      expect(callArgs.config.tools).toEqual([{
        functionDeclarations: [{
          name: 'get_weather',
          description: 'Get the weather for a location',
          parametersJsonSchema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location']
          }
        }]
      }]);
      expect(callArgs.config.toolConfig).toEqual({
        functionCallingConfig: { mode: 'AUTO' }
      });
    });

    it('should convert toolChoice "none" to NONE mode', async () => {
      const mockGenerateContent = driver['client'].models.generateContent as ReturnType<typeof vi.fn>;

      await driver.query(basicPrompt, {
        tools: toolDefs,
        toolChoice: 'none'
      });

      const callArgs = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      expect(callArgs.config.toolConfig).toEqual({
        functionCallingConfig: { mode: 'NONE' }
      });
    });

    it('should convert toolChoice "required" to ANY mode', async () => {
      const mockGenerateContent = driver['client'].models.generateContent as ReturnType<typeof vi.fn>;

      await driver.query(basicPrompt, {
        tools: toolDefs,
        toolChoice: 'required'
      });

      const callArgs = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      expect(callArgs.config.toolConfig).toEqual({
        functionCallingConfig: { mode: 'ANY' }
      });
    });

    it('should convert specific function toolChoice to ANY with allowedFunctionNames', async () => {
      const mockGenerateContent = driver['client'].models.generateContent as ReturnType<typeof vi.fn>;

      await driver.query(basicPrompt, {
        tools: toolDefs,
        toolChoice: { type: 'function', function: { name: 'get_weather' } }
      });

      const callArgs = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      expect(callArgs.config.toolConfig).toEqual({
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['get_weather']
        }
      });
    });

    it('should not include tools in config when not specified', async () => {
      const mockGenerateContent = driver['client'].models.generateContent as ReturnType<typeof vi.fn>;

      await driver.query(basicPrompt);

      const callArgs = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      expect(callArgs.config).not.toHaveProperty('tools');
      expect(callArgs.config).not.toHaveProperty('toolConfig');
    });

    it('should extract single tool call from query response', async () => {
      vi.spyOn(driver['client'].models, 'generateContent').mockResolvedValue({
        get text() { throw new Error('no text'); },
        candidates: [{
          finishReason: 'STOP',
          content: {
            parts: [{
              functionCall: {
                id: 'call_abc123',
                name: 'get_weather',
                args: { location: 'Tokyo' }
              }
            }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15
        }
      });

      const result = await driver.query(basicPrompt, { tools: toolDefs });

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
      vi.spyOn(driver['client'].models, 'generateContent').mockResolvedValue({
        get text() { throw new Error('no text'); },
        candidates: [{
          finishReason: 'STOP',
          content: {
            parts: [
              {
                functionCall: {
                  id: 'call_1',
                  name: 'get_weather',
                  args: { location: 'Tokyo' }
                }
              },
              {
                functionCall: {
                  id: 'call_2',
                  name: 'get_weather',
                  args: { location: 'Osaka' }
                }
              }
            ]
          }
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15
        }
      });

      const result = await driver.query(basicPrompt, { tools: toolDefs });

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].id).toBe('call_1');
      expect(result.toolCalls![0].function.arguments).toBe('{"location":"Tokyo"}');
      expect(result.toolCalls![1].id).toBe('call_2');
      expect(result.toolCalls![1].function.arguments).toBe('{"location":"Osaka"}');
    });

    it('should generate fallback id when response has no id', async () => {
      vi.spyOn(driver['client'].models, 'generateContent').mockResolvedValue({
        get text() { throw new Error('no text'); },
        candidates: [{
          finishReason: 'STOP',
          content: {
            parts: [{
              functionCall: {
                name: 'get_weather',
                args: { location: 'Tokyo' }
              }
            }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15
        }
      });

      const result = await driver.query(basicPrompt, { tools: toolDefs });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].id).toBe('call_0');
    });

    it('should handle text and tool calls mixed response', async () => {
      vi.spyOn(driver['client'].models, 'generateContent').mockResolvedValue({
        text: 'I will check the weather for you.',
        candidates: [{
          finishReason: 'STOP',
          content: {
            parts: [
              { text: 'I will check the weather for you.' },
              {
                functionCall: {
                  id: 'call_1',
                  name: 'get_weather',
                  args: { location: 'Tokyo' }
                }
              }
            ]
          }
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30
        }
      });

      const result = await driver.query(basicPrompt, { tools: toolDefs });

      expect(result.content).toBe('I will check the weather for you.');
      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
    });

    it('should not include toolCalls when no function calls in response', async () => {
      const result = await driver.query(basicPrompt);

      expect(result.toolCalls).toBeUndefined();
    });

    it('should extract tool calls from stream response', async () => {
      vi.spyOn(driver['client'].models, 'generateContentStream').mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            text: 'Checking weather...',
            candidates: [{
              finishReason: undefined,
              content: {
                parts: [{ text: 'Checking weather...' }]
              }
            }]
          };
          yield {
            get text() { throw new Error('no text'); },
            candidates: [{
              finishReason: 'STOP',
              content: {
                parts: [{
                  functionCall: {
                    id: 'call_stream_1',
                    name: 'get_weather',
                    args: { location: 'Tokyo' }
                  }
                }]
              }
            }]
          };
        }
      } as unknown as ReturnType<typeof driver['client']['models']['generateContentStream']>);

      const { stream, result } = await driver.streamQuery(basicPrompt, { tools: toolDefs });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Checking weather...']);

      const finalResult = await result;
      expect(finalResult.finishReason).toBe('tool_calls');
      expect(finalResult.toolCalls).toHaveLength(1);
      expect(finalResult.toolCalls![0]).toEqual({
        id: 'call_stream_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Tokyo"}'
        }
      });
    });

    it('should handle tool-call-only stream response (no text)', async () => {
      vi.spyOn(driver['client'].models, 'generateContentStream').mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            get text() { throw new Error('no text'); },
            candidates: [{
              finishReason: 'STOP',
              content: {
                parts: [{
                  functionCall: {
                    id: 'call_only_1',
                    name: 'get_weather',
                    args: { location: 'Tokyo' }
                  }
                }]
              }
            }]
          };
        }
      } as unknown as ReturnType<typeof driver['client']['models']['generateContentStream']>);

      const { stream, result } = await driver.streamQuery(basicPrompt, { tools: toolDefs });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);

      const finalResult = await result;
      expect(finalResult.content).toBe('');
      expect(finalResult.finishReason).toBe('tool_calls');
      expect(finalResult.toolCalls).toHaveLength(1);
    });

    it('should pass tools config in streamQuery', async () => {
      const mockGenerateContentStream = driver['client'].models.generateContentStream as ReturnType<typeof vi.fn>;

      await driver.streamQuery(basicPrompt, {
        tools: toolDefs,
        toolChoice: 'required'
      });

      const callArgs = mockGenerateContentStream.mock.calls[mockGenerateContentStream.mock.calls.length - 1][0];
      expect(callArgs.config.tools).toEqual([{
        functionDeclarations: [{
          name: 'get_weather',
          description: 'Get the weather for a location',
          parametersJsonSchema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location']
          }
        }]
      }]);
      expect(callArgs.config.toolConfig).toEqual({
        functionCallingConfig: { mode: 'ANY' }
      });
    });
  });

  describe('finish reason mapping', () => {
    it('should map finish reasons correctly', async () => {
      const testCases = [
        { apiReason: 'STOP', expected: 'stop' },
        { apiReason: 'MAX_TOKENS', expected: 'length' },
        { apiReason: 'SAFETY', expected: 'stop' },
        { apiReason: 'OTHER', expected: 'error' }
      ];

      for (const { apiReason, expected } of testCases) {
        vi.spyOn(driver['client'].models, 'generateContent').mockResolvedValue({
          text: 'Test',  // convenience property
          candidates: [{
            finishReason: apiReason
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30
          }
        });

        const result = await driver.query({
          instructions: [],
          data: [],
          output: []
        });

        expect(result.finishReason).toBe(expected);
      }
    });
  });
});
