import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleGenAICacheController } from './google-genai-cache-controller.js';
import { GoogleGenAIDriver } from './google-genai-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { PromptCacheController } from '../cache-controller.js';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'Test response',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
          }),
          generateContentStream: vi.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {
              yield { text: 'Streamed', candidates: [{ finishReason: 'STOP' }] };
            },
          })
        },
        caches: {
          create: vi.fn().mockResolvedValue({ name: 'cachedContents/test-cache-123' }),
          delete: vi.fn().mockResolvedValue({}),
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

describe('GoogleGenAICacheController', () => {
  let mockClient: { caches: { create: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } };
  let controller: GoogleGenAICacheController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      caches: {
        create: vi.fn().mockResolvedValue({ name: 'cachedContents/test-cache-123' }),
        delete: vi.fn().mockResolvedValue({}),
      }
    };
    controller = new GoogleGenAICacheController(mockClient as any);
  });

  describe('prepare', () => {
    it('should create cache with instructions and data', async () => {
      const handle = await controller.prepare({
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text', content: 'Be helpful' }],
        data: [{ type: 'material', id: 'm1', title: 'Doc', content: 'reference text' }],
      });

      expect(handle.ref).toBe('cachedContents/test-cache-123');
      expect(handle.includes.instructions).toBe(true);
      expect(handle.includes.dataElementCount).toBe(1);
      expect(handle.includes.tools).toBe(false);

      expect(mockClient.caches.create).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        config: expect.objectContaining({
          systemInstruction: expect.any(Array),
          contents: expect.any(Array),
          ttl: '3600s',
        }),
      });
    });

    it('should include tools when provided', async () => {
      const handle = await controller.prepare({
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text', content: 'system prompt' }],
        tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }],
      });

      expect(handle.includes.tools).toBe(true);
      const createCall = mockClient.caches.create.mock.calls[0][0];
      expect(createCall.config.tools).toBeDefined();
    });

    it('should use custom TTL from config', async () => {
      const customController = new GoogleGenAICacheController(mockClient as any, { ttl: '7200s' });
      await customController.prepare({
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text', content: 'prompt' }],
      });

      const createCall = mockClient.caches.create.mock.calls[0][0];
      expect(createCall.config.ttl).toBe('7200s');
    });

    it('should handle empty instructions and data', async () => {
      const handle = await controller.prepare({
        model: 'gemini-2.5-flash',
      });

      expect(handle.includes.instructions).toBe(false);
      expect(handle.includes.dataElementCount).toBe(0);
    });

    it('should reuse cache for identical params', async () => {
      const params = {
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text' as const, content: 'Be helpful' }],
        data: [{ type: 'material' as const, id: 'm1', title: 'Doc', content: 'text' }],
      };
      const handle1 = await controller.prepare(params);
      const handle2 = await controller.prepare(params);

      expect(handle1.ref).toBe(handle2.ref);
      expect(mockClient.caches.create).toHaveBeenCalledTimes(1);
    });

    it('should create separate caches for different params', async () => {
      mockClient.caches.create
        .mockResolvedValueOnce({ name: 'cachedContents/cache-1' })
        .mockResolvedValueOnce({ name: 'cachedContents/cache-2' });

      const handle1 = await controller.prepare({
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text' as const, content: 'prompt A' }],
      });
      const handle2 = await controller.prepare({
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text' as const, content: 'prompt B' }],
      });

      expect(handle1.ref).not.toBe(handle2.ref);
      expect(mockClient.caches.create).toHaveBeenCalledTimes(2);
    });

    it('should throw when cache.name is missing', async () => {
      mockClient.caches.create.mockResolvedValueOnce({ name: undefined });

      await expect(controller.prepare({
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      })).rejects.toThrow('returned a cache without a name');
    });

    it('should re-create cache after TTL expiry', async () => {
      const shortTtlController = new GoogleGenAICacheController(mockClient as any, { ttl: '1s' });
      const params = {
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };

      mockClient.caches.create.mockResolvedValueOnce({ name: 'cachedContents/first' });
      const handle1 = await shortTtlController.prepare(params);
      expect(handle1.ref).toBe('cachedContents/first');

      // Simulate TTL expiry by advancing Date.now
      const originalNow = Date.now;
      Date.now = () => originalNow() + 2000;
      try {
        mockClient.caches.create.mockResolvedValueOnce({ name: 'cachedContents/second' });
        const handle2 = await shortTtlController.prepare(params);
        expect(handle2.ref).toBe('cachedContents/second');
        expect(mockClient.caches.create).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = originalNow;
      }
    });

    it('should coalesce concurrent calls with identical params', async () => {
      let resolveCreate: (val: { name: string }) => void;
      mockClient.caches.create.mockReturnValueOnce(
        new Promise(resolve => { resolveCreate = resolve; })
      );

      const params = {
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };
      const p1 = controller.prepare(params);
      const p2 = controller.prepare(params);

      resolveCreate!({ name: 'cachedContents/coalesced' });

      const [h1, h2] = await Promise.all([p1, p2]);
      expect(h1.ref).toBe('cachedContents/coalesced');
      expect(h2.ref).toBe('cachedContents/coalesced');
      expect(mockClient.caches.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidate', () => {
    it('should delete the cached content', async () => {
      const handle = await controller.prepare({
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text', content: 'prompt' }],
      });

      await controller.invalidate(handle);
      expect(mockClient.caches.delete).toHaveBeenCalledWith({ name: 'cachedContents/test-cache-123' });
    });

    it('should allow re-creation after invalidation', async () => {
      const params = {
        model: 'gemini-2.5-flash',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };
      const handle1 = await controller.prepare(params);
      await controller.invalidate(handle1);

      mockClient.caches.create.mockResolvedValueOnce({ name: 'cachedContents/new-cache' });
      const handle2 = await controller.prepare(params);

      expect(handle2.ref).toBe('cachedContents/new-cache');
      expect(mockClient.caches.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('close', () => {
    it('should delete all managed caches', async () => {
      await controller.prepare({ model: 'gemini-2.5-flash', instructions: [{ type: 'text', content: 'a' }] });
      await controller.prepare({ model: 'gemini-2.5-flash', instructions: [{ type: 'text', content: 'b' }] });

      await controller.close();
      expect(mockClient.caches.delete).toHaveBeenCalledTimes(2);
    });
  });
});

describe('GoogleGenAIDriver with CacheController', () => {
  let driver: GoogleGenAIDriver;
  let mockController: PromptCacheController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockController = {
      prepare: vi.fn().mockResolvedValue({
        ref: 'cachedContents/abc',
        includes: { instructions: true, dataElementCount: 1, tools: false },
      }),
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    driver = new GoogleGenAIDriver({
      apiKey: 'test-api-key',
      model: 'gemini-2.5-flash',
      cacheController: mockController,
    });
  });

  it('should use cacheController when present', async () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'Be helpful' }],
      data: [
        { type: 'material', id: 'm1', title: 'Doc', content: 'stable content' },
        { type: 'chunk', partOf: 'doc', content: 'volatile part' },
      ],
      output: [{ type: 'text', content: 'respond' }],
    };

    await driver.query(prompt);

    expect(mockController.prepare).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      instructions: [{ type: 'text', content: 'Be helpful' }],
      data: [{ type: 'material', id: 'm1', title: 'Doc', content: 'stable content' }],
      tools: undefined,
    });

    const generateContent = (driver as any).client.models.generateContent;
    const callArgs = generateContent.mock.calls[0][0];
    expect(callArgs.config.cachedContent).toBe('cachedContents/abc');
    expect(callArgs.config.systemInstruction).toBeUndefined();
  });

  it('should not include systemInstruction when cached', async () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'system' }],
      data: [],
      output: [{ type: 'text', content: 'go' }],
    };

    await driver.query(prompt);

    const generateContent = (driver as any).client.models.generateContent;
    const config = generateContent.mock.calls[0][0].config;
    expect(config.cachedContent).toBe('cachedContents/abc');
    expect(config.systemInstruction).toBeUndefined();
  });

  it('should include tools in API call when not cached', async () => {
    const tools = [{ name: 'search', description: 'Search' }];
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'system' }],
      data: [],
      output: [{ type: 'text', content: 'go' }],
    };

    await driver.query(prompt, { tools });

    const generateContent = (driver as any).client.models.generateContent;
    const config = generateContent.mock.calls[0][0].config;
    expect(config.tools).toBeDefined();
  });

  it('should pass volatile data and output as contents', async () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'system' }],
      data: [
        { type: 'chunk', partOf: 'doc', content: 'volatile chunk' },
      ],
      output: [{ type: 'text', content: 'respond now' }],
    };

    await driver.query(prompt);

    const generateContent = (driver as any).client.models.generateContent;
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents).toHaveLength(2);
  });

  it('should send volatile instructions as systemInstruction even when cache includes instructions', async () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Static rule' },
        { type: 'text', content: 'Current time is 12:00', cacheHint: 'contextual' },
      ],
      data: [],
      output: [{ type: 'text', content: 'go' }],
    };

    await driver.query(prompt);

    const generateContent = (driver as any).client.models.generateContent;
    const config = generateContent.mock.calls[0][0].config;
    expect(config.cachedContent).toBe('cachedContents/abc');
    expect(config.systemInstruction).toBeDefined();
    expect(config.systemInstruction).toHaveLength(1);
    expect(config.systemInstruction[0].text).toContain('Current time');
  });

  it('should work with streamQuery', async () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'system' }],
      data: [{ type: 'material', id: 'm1', title: 'Doc', content: 'stable' }],
      output: [{ type: 'text', content: 'go' }],
    };

    const { result } = await driver.streamQuery(prompt);
    const queryResult = await result;

    expect(mockController.prepare).toHaveBeenCalled();
    expect(queryResult.content).toBe('Streamed');

    const generateContentStream = (driver as any).client.models.generateContentStream;
    const config = generateContentStream.mock.calls[0][0].config;
    expect(config.cachedContent).toBe('cachedContents/abc');
  });

  it('should fall back to sending all instructions when cache excludes them', async () => {
    const controllerNoInstructions: PromptCacheController = {
      prepare: vi.fn().mockResolvedValue({
        ref: 'cachedContents/partial',
        includes: { instructions: false, dataElementCount: 1, tools: false },
      }),
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    const partialDriver = new GoogleGenAIDriver({
      apiKey: 'test-api-key',
      model: 'gemini-2.5-flash',
      cacheController: controllerNoInstructions,
    });

    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'Static rule' }],
      data: [{ type: 'material', id: 'm1', title: 'Doc', content: 'text' }],
      output: [{ type: 'text', content: 'go' }],
    };

    await partialDriver.query(prompt);

    const generateContent = (partialDriver as any).client.models.generateContent;
    const config = generateContent.mock.calls[0][0].config;
    expect(config.cachedContent).toBe('cachedContents/partial');
    expect(config.systemInstruction).toBeDefined();
    expect(config.systemInstruction).toHaveLength(1);
    expect(config.systemInstruction[0].text).toContain('Static rule');
  });

  it('should fall back to sending all data when cache excludes them', async () => {
    const controllerNoData: PromptCacheController = {
      prepare: vi.fn().mockResolvedValue({
        ref: 'cachedContents/no-data',
        includes: { instructions: true, dataElementCount: 0, tools: false },
      }),
      invalidate: vi.fn(),
      close: vi.fn(),
    };
    const noDataDriver = new GoogleGenAIDriver({
      apiKey: 'test-api-key',
      model: 'gemini-2.5-flash',
      cacheController: controllerNoData,
    });

    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'system' }],
      data: [
        { type: 'material', id: 'm1', title: 'Doc', content: 'stable' },
        { type: 'chunk', partOf: 'doc', content: 'volatile' },
      ],
      output: [{ type: 'text', content: 'go' }],
    };

    await noDataDriver.query(prompt);

    const generateContent = (noDataDriver as any).client.models.generateContent;
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents.length).toBeGreaterThanOrEqual(3);
  });

  it('should skip cache when all cacheable elements are empty', async () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'dynamic only', cacheHint: 'contextual' }],
      data: [{ type: 'chunk', partOf: 'doc', content: 'volatile' }],
      output: [{ type: 'text', content: 'go' }],
    };

    await driver.query(prompt);

    expect(mockController.prepare).not.toHaveBeenCalled();
    const generateContent = (driver as any).client.models.generateContent;
    const config = generateContent.mock.calls[0][0].config;
    expect(config.cachedContent).toBeUndefined();
    expect(config.systemInstruction).toBeDefined();
  });
});
