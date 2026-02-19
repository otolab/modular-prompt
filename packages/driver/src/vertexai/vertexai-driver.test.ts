import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VertexAIDriver } from './vertexai-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ToolDefinition } from '../types.js';

// Shared mock functions (hoisted for vi.mock factory)
const { mockGenerateContent, mockGenerateContentStream } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateContentStream: vi.fn()
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
        toolChoice: { type: 'function', function: { name: 'get_weather' } }
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
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Tokyo"}'
        }
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
      expect(result.toolCalls![0].function.name).toBe('get_weather');
      expect(result.toolCalls![1].function.name).toBe('get_weather');
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
      expect(finalResult.toolCalls![0].function.name).toBe('get_weather');
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
        m.parts.some((p: { functionResponse?: unknown }) => p.functionResponse)
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.parts[0]).toMatchObject({
        functionResponse: expect.objectContaining({
          name: 'get_weather',
          response: { temp: 25 }
        })
      });
    });
  });

});