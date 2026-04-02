import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VertexAIDriver } from './vertexai-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ToolDefinition } from '../types.js';

// Shared mock functions (hoisted for vi.mock factory)
const { mockGenerateContent, mockGenerateContentStream, mockOpenAIQuery, mockOpenAIStreamQuery, mockOpenAIClose } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateContentStream: vi.fn(),
  mockOpenAIQuery: vi.fn(),
  mockOpenAIStreamQuery: vi.fn(),
  mockOpenAIClose: vi.fn(),
}));

// Mock google-auth-library
vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  })),
}));

// Mock OpenAIDriver
vi.mock('../openai/openai-driver.js', () => ({
  OpenAIDriver: vi.fn().mockImplementation(() => ({
    query: mockOpenAIQuery,
    streamQuery: mockOpenAIStreamQuery,
    close: mockOpenAIClose,
  })),
}));

// Mock @google-cloud/vertexai module
vi.mock('@google-cloud/vertexai', () => {
  mockGenerateContent.mockResolvedValue({
    response: {
      candidates: [{
        content: {
          parts: [{ text: 'Mocked Vertex AI response' }],
          role: 'model'
        },
        finishReason: 'STOP'
      }],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 8,
        totalTokenCount: 23
      }
    }
  });
  
  mockGenerateContentStream.mockResolvedValue({
    stream: (async function* () {
      yield {
        candidates: [{
          content: {
            parts: [{ text: 'Streaming ' }]
          }
        }]
      };
      yield {
        candidates: [{
          content: {
            parts: [{ text: 'response' }]
          }
        }]
      };
    })(),
    response: Promise.resolve({
      candidates: [{
        content: {
          parts: [{ text: 'Streaming response' }],
          role: 'model'
        },
        finishReason: 'STOP'
      }],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 8,
        totalTokenCount: 23
      }
    })
  });
  
  return {
    VertexAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: (...args: unknown[]) => mockGenerateContent(...args),
        generateContentStream: (...args: unknown[]) => mockGenerateContentStream(...args)
      }),
      preview: {
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: (...args: unknown[]) => mockGenerateContent(...args),
          generateContentStream: (...args: unknown[]) => mockGenerateContentStream(...args)
        })
      }
    })),
    HarmCategory: {
      HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT'
    },
    HarmBlockThreshold: {
      BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE'
    },
    SchemaType: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT'
    },
    FunctionCallingMode: {
      MODE_UNSPECIFIED: 'MODE_UNSPECIFIED',
      AUTO: 'AUTO',
      ANY: 'ANY',
      NONE: 'NONE'
    }
  };
});

describe('VertexAIDriver', () => {
  let driver: VertexAIDriver;
  
  beforeEach(() => {
    // Set environment variable for project
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    
    driver = new VertexAIDriver({
      project: 'test-project',
      location: 'us-central1',
      model: 'gemini-2.0-flash-001'
    });
  });
  
  it('should initialize with config', () => {
    expect(driver).toBeDefined();
  });
  
  it('should throw error if project is not provided', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    
    expect(() => new VertexAIDriver({
      location: 'us-central1'
    })).toThrow('VertexAI project ID is required');
  });
  
  it('should query with a compiled prompt', async () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'You are a helpful assistant' }
      ],
      data: [
        { type: 'text', content: 'User data here' }
      ],
      output: []
    };
    
    const result = await driver.query(prompt);
    
    expect(result.content).toBe('Mocked Vertex AI response');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: 8,
      totalTokens: 23
    });
  });
  
  it('should handle query options', async () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        { type: 'text', content: 'Process this data' }
      ],
      output: []
    };
    
    const result = await driver.query(prompt, {
      temperature: 0.8,
      maxTokens: 500,
      topP: 0.95,
      topK: 40
    });
    
    expect(result.content).toBe('Mocked Vertex AI response');
  });
  
  it('should handle streaming', async () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Stream test' }
      ],
      data: [],
      output: []
    };
    
    const { stream } = await driver.streamQuery(prompt);

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Streaming ', 'response']);
  });
  
  it('should handle errors gracefully', async () => {
    // Create a driver that will throw an error
    const VertexAI = (await import('@google-cloud/vertexai')).VertexAI as unknown as ReturnType<typeof vi.fn>;
    VertexAI.mockImplementationOnce(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn().mockRejectedValue(new Error('API Error'))
      })
    }));
    
    const errorDriver = new VertexAIDriver({
      project: 'test-project'
    });
    
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'Test' }],
      data: [],
      output: []
    };
    
    const result = await errorDriver.query(prompt);
    
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });
  
  describe('tools support', () => {
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
      data: [{ type: 'text', content: 'Data' }],
      output: []
    };

    it('should pass tools and toolChoice to API request', async () => {
      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'auto'
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({ name: 'get_weather' })
              ])
            })
          ]),
          toolConfig: expect.objectContaining({
            functionCallingConfig: expect.objectContaining({ mode: 'AUTO' })
          })
        })
      );
    });

    it('should pass toolChoice "required" as ANY mode', async () => {
      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'required'
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          toolConfig: expect.objectContaining({
            functionCallingConfig: expect.objectContaining({ mode: 'ANY' })
          })
        })
      );
    });

    it('should pass toolChoice "none" as NONE mode', async () => {
      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: 'none'
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          toolConfig: expect.objectContaining({
            functionCallingConfig: expect.objectContaining({ mode: 'NONE' })
          })
        })
      );
    });

    it('should pass specific function toolChoice as ANY with allowedFunctionNames', async () => {
      await driver.query(prompt, {
        tools: toolDefs,
        toolChoice: { name: 'get_weather' }
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          toolConfig: expect.objectContaining({
            functionCallingConfig: expect.objectContaining({
              mode: 'ANY',
              allowedFunctionNames: ['get_weather']
            })
          })
        })
      );
    });

    it('should not include tools in request when not specified', async () => {
      await driver.query(prompt);

      const calledRequest = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      expect(calledRequest).not.toHaveProperty('tools');
      expect(calledRequest).not.toHaveProperty('toolConfig');
    });

    it('should extract tool calls from response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { location: 'Tokyo' }
                  }
                }
              ],
              role: 'model'
            },
            finishReason: 'STOP'
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15
          }
        }
      });

      const result = await driver.query(prompt, { tools: toolDefs });

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_0',
        name: 'get_weather',
        arguments: { location: 'Tokyo' }
      });
    });

    it('should handle multiple tool calls', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: {
              parts: [
                { functionCall: { name: 'get_weather', args: { location: 'Tokyo' } } },
                { functionCall: { name: 'get_weather', args: { location: 'Osaka' } } }
              ],
              role: 'model'
            },
            finishReason: 'STOP'
          }]
        }
      });

      const result = await driver.query(prompt, { tools: toolDefs });

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].name).toBe('get_weather');
      expect(result.toolCalls![1].name).toBe('get_weather');
      expect(result.toolCalls![0].id).toBe('call_0');
      expect(result.toolCalls![1].id).toBe('call_1');
    });

    it('should return undefined toolCalls when no function calls in response', async () => {
      const result = await driver.query(prompt);

      expect(result.toolCalls).toBeUndefined();
    });

    it('should handle tool calls in streamQuery result', async () => {
      mockGenerateContentStream.mockResolvedValueOnce({
        stream: (async function* () {
          yield {
            candidates: [{
              content: {
                parts: [{ text: 'Checking...' }]
              }
            }]
          };
        })(),
        response: Promise.resolve({
          candidates: [{
            content: {
              parts: [
                { text: 'Checking...' },
                { functionCall: { name: 'get_weather', args: { location: 'Tokyo' } } }
              ],
              role: 'model'
            },
            finishReason: 'STOP'
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15
          }
        })
      });

      const { stream, result } = await driver.streamQuery(prompt, { tools: toolDefs });

      // Stream should yield text only
      const streamChunks: string[] = [];
      for await (const chunk of stream) {
        streamChunks.push(chunk);
      }
      expect(streamChunks).toEqual(['Checking...']);

      // Result should have tool calls
      const finalResult = await result;
      expect(finalResult.finishReason).toBe('tool_calls');
      expect(finalResult.toolCalls).toHaveLength(1);
      expect(finalResult.toolCalls![0].name).toBe('get_weather');
    });

    it('should use tools from defaultOptions', async () => {
      const toolDriver = new VertexAIDriver({
        project: 'test-project',
        defaultOptions: {
          tools: toolDefs,
          toolChoice: 'auto'
        }
      });

      await toolDriver.query(prompt);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({ name: 'get_weather' })
              ])
            })
          ])
        })
      );
    });
  });

  it('should handle JSON response format', async () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Return JSON' }
      ],
      data: [],
      output: []
    };

    const result = await driver.query(prompt, {
      responseFormat: 'json',
      jsonSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        }
      }
    });

    expect(result.content).toBe('Mocked Vertex AI response');
  });

  describe('convertJsonSchema sanitization', () => {
    it('should remove unsupported JSON Schema fields with warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [{ type: 'text', content: 'Data' }],
        output: []
      };

      const toolsWithPropertyNames: ToolDefinition[] = [{
        name: 'update_metadata',
        description: 'Update metadata',
        parameters: {
          type: 'object',
          properties: {
            metadata: {
              type: 'object',
              propertyNames: { type: 'string', maxLength: 64 },
              additionalProperties: { type: 'string' },
            }
          },
          required: ['metadata'],
          propertyNames: { type: 'string' },
        }
      }];

      await driver.query(prompt, { tools: toolsWithPropertyNames });

      // propertyNames と additionalProperties が警告されること
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"propertyNames"')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"additionalProperties"')
      );

      // API に渡されたパラメータに propertyNames が含まれないこと
      const calledRequest = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      const params = calledRequest.tools[0].functionDeclarations[0].parameters;
      expect(params).not.toHaveProperty('propertyNames');
      expect(params.properties.metadata).not.toHaveProperty('propertyNames');
      expect(params.properties.metadata).not.toHaveProperty('additionalProperties');

      warnSpy.mockRestore();
    });

    it('should preserve supported fields', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Test' }],
        data: [{ type: 'text', content: 'Data' }],
        output: []
      };

      const tools: ToolDefinition[] = [{
        name: 'create_item',
        description: 'Create item',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Item name' },
            tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
          },
          required: ['name'],
        }
      }];

      await driver.query(prompt, { tools });

      expect(warnSpy).not.toHaveBeenCalled();

      const calledRequest = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
      const params = calledRequest.tools[0].functionDeclarations[0].parameters;
      expect(params.type).toBe('OBJECT');
      expect(params.properties.name.type).toBe('STRING');
      expect(params.properties.name.description).toBe('Item name');
      expect(params.properties.tags.type).toBe('ARRAY');
      expect(params.properties.tags.items.type).toBe('STRING');
      expect(params.properties.tags.items.enum).toEqual(['a', 'b']);
      expect(params.required).toEqual(['name']);

      warnSpy.mockRestore();
    });

    it('should convert type array with null to nullable', () => {
      const schema = (driver as unknown as { convertJsonSchema: (s: unknown) => unknown }).convertJsonSchema({
        type: 'object',
        properties: {
          title: { type: ['string', 'null'] },
          count: { type: 'integer' },
        },
        required: ['count'],
      });

      expect(schema).toEqual({
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', nullable: true },
          count: { type: 'INTEGER' },
        },
        required: ['count'],
      });
    });
  });

  describe('tool message elements', () => {
    it('should convert tool call and tool result messages to VertexAI API format', async () => {
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

      await driver.query(prompt);

      // APIに渡されたcontentsを検証
      const calledRequest = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];

      // model message: role: 'model', partsにfunctionCallを含む
      const modelMsg = calledRequest.contents.find((c: { role: string }) => c.role === 'model');
      expect(modelMsg).toBeDefined();
      expect(modelMsg.parts).toContainEqual(
        expect.objectContaining({ text: 'Let me check the weather' })
      );
      expect(modelMsg.parts).toContainEqual(
        expect.objectContaining({
          functionCall: expect.objectContaining({
            name: 'get_weather',
            args: { city: 'Tokyo' }
          })
        })
      );

      // user message (tool result): role: 'user', parts[0].functionResponseを含む
      const userMsgs = calledRequest.contents.filter((c: { role: string }) => c.role === 'user');
      const toolResultMsg = userMsgs.find((m: { parts: unknown[] }) =>
        m.parts.some((p: unknown) => (p as { functionResponse?: unknown }).functionResponse)
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.parts[0]).toMatchObject({
        functionResponse: expect.objectContaining({
          name: 'get_weather',
          response: { temp: 25 }
        })
      });
    });

    it('should convert tool result with error kind to VertexAI API format', async () => {
      const prompt: CompiledPrompt = {
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

      await driver.query(prompt);

      const calledRequest = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];

      // user message (tool result): functionResponse with error wrapper
      const userMsgs = calledRequest.contents.filter((c: { role: string }) => c.role === 'user');
      const toolResultMsg = userMsgs.find((m: { parts: unknown[] }) =>
        m.parts.some((p: unknown) => (p as { functionResponse?: unknown }).functionResponse)
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.parts[0]).toMatchObject({
        functionResponse: expect.objectContaining({
          name: 'get_weather',
          response: { error: 'Connection timeout' }
        })
      });
    });
  });

  describe('model publisher routing', () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'Test' }],
      data: [{ type: 'text', content: 'Data' }],
      output: []
    };

    beforeEach(() => {
      mockOpenAIQuery.mockReset();
      mockOpenAIStreamQuery.mockReset();
      mockOpenAIQuery.mockResolvedValue({
        content: 'OpenAI response',
        finishReason: 'stop' as const,
      });
      mockOpenAIStreamQuery.mockResolvedValue({
        stream: (async function* () { yield 'chunk'; })(),
        result: Promise.resolve({ content: 'streamed', finishReason: 'stop' as const }),
      });
    });

    it('should use generateContent for simple model names', async () => {
      await driver.query(prompt, { model: 'gemini-2.0-flash' });
      expect(mockGenerateContent).toHaveBeenCalled();
      expect(mockOpenAIQuery).not.toHaveBeenCalled();
    });

    it('should use generateContent for google publisher full path', async () => {
      await driver.query(prompt, {
        model: 'projects/my-project/locations/us-central1/publishers/google/models/gemini-2.0-flash'
      });
      expect(mockGenerateContent).toHaveBeenCalled();
      expect(mockOpenAIQuery).not.toHaveBeenCalled();
    });

    it('should route to OpenAI driver for non-google publisher', async () => {
      const result = await driver.query(prompt, {
        model: 'projects/my-project/locations/us-central1/publishers/qwen/models/qwen3-235b'
      });
      expect(mockOpenAIQuery).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({ model: 'qwen3-235b' })
      );
      expect(result.content).toBe('OpenAI response');
    });

    it('should route streamQuery to OpenAI driver for non-google publisher', async () => {
      const result = await driver.streamQuery(prompt, {
        model: 'projects/my-project/locations/us-central1/publishers/meta/models/llama-3-405b'
      });
      expect(mockOpenAIStreamQuery).toHaveBeenCalledWith(
        prompt,
        expect.objectContaining({ model: 'llama-3-405b' })
      );
      expect(result).toBeDefined();
    });

    it('should throw error for anthropic publisher', async () => {
      await expect(driver.query(prompt, {
        model: 'projects/my-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6'
      })).rejects.toThrow('Anthropic models are not supported via VertexAIDriver');
    });

    it('should throw error for anthropic publisher in streamQuery', async () => {
      await expect(driver.streamQuery(prompt, {
        model: 'projects/my-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6'
      })).rejects.toThrow('Anthropic models are not supported via VertexAIDriver');
    });
  });

});