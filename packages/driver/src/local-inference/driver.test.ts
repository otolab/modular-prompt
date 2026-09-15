import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import type { CompiledPrompt } from '@modular-prompt/core';
import { LocalInferenceDriver } from './driver.js';
import type { LocalInferenceAdapters } from './adapters.js';
import type { InferenceProcessPort } from './process-port.js';

const mockCapabilities = {
  methods: ['render', 'generate', 'capabilities'],
  special_tokens: {},
  features: {
    apply_chat_template: true,
    vocab_size: 32000,
    model_max_length: 4096,
    chat_template: {
      supported_roles: ['system', 'user', 'assistant'],
      preview: null,
      constraints: {},
    },
  },
};

function createMockStream(chunks: string[]): Readable {
  return Readable.from(chunks);
}

function createMockProcess(): InferenceProcessPort {
  return {
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue(mockCapabilities),
    render: vi.fn().mockResolvedValue({ formatted_prompt: 'rendered-prompt', error: null }),
    generate: vi.fn().mockResolvedValue(createMockStream(['ok'])),
    cancelActiveRequest: vi.fn(),
    exit: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAdapters(overrides?: Partial<LocalInferenceAdapters>): LocalInferenceAdapters {
  return {
    mergeQueryOptions: (defaults, options) => ({ ...defaults, ...options }),
    toSamplingOptions: (merged) => ({ maxTokens: merged.maxTokens as number | undefined }),
    createModelProcessor: () => ({
      applyChatSpecificProcessing: (messages) => messages,
      applyCompletionSpecificProcessing: (prompt) => prompt,
      hasCompletionProcessor: () => false,
      hasChatProcessor: () => false,
      setRuntimeContext: vi.fn(),
    }),
    selectResponseProcessor: () => (content) => ({ content }),
    convertToolDefinitions: vi.fn(),
    convertMessages: (messages) =>
      messages.map((m) => ({ role: m.role, content: m.content as string })),
    extractImagePaths: () => [],
    formatToolDefinitionsAsText: () => '',
    generateMergedPrompt: () => '<!-- begin of USER -->\ntest\n<!-- end of USER -->',
    selectApi: (strategy, mode, hasChatTemplate) => {
      if (mode === 'instruct') return 'completion';
      if (mode === 'chat') return 'chat';
      return hasChatTemplate ? 'chat' : 'completion';
    },
    ...overrides,
  };
}

const prompt: CompiledPrompt = {
  instructions: [{ type: 'text', content: 'test' }],
  data: [],
  output: [],
};

const META_MARKER = '\x1e__META__:';

describe('LocalInferenceDriver', () => {
  let mockProcess: InferenceProcessPort;
  let mockAdapters: LocalInferenceAdapters;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockProcess();
    mockAdapters = createMockAdapters();
  });

  function createDriver(defaultOptions?: Record<string, unknown>) {
    return new LocalInferenceDriver({
      model: 'test-model',
      process: mockProcess,
      adapters: mockAdapters,
      defaultOptions,
      loggerPrefix: 'TEST',
    });
  }

  it('uses render + generate for chat path', async () => {
    const driver = createDriver({ mode: 'chat' });
    await driver.query(prompt);

    expect(mockProcess.render).toHaveBeenCalled();
    expect(mockProcess.generate).toHaveBeenCalled();
    expect(mockProcess.generate).toHaveBeenCalledWith(
      'rendered-prompt',
      expect.any(Object),
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('uses generate only for completion path', async () => {
    const driver = createDriver({ mode: 'instruct' });
    await driver.query(prompt);

    expect(mockProcess.render).not.toHaveBeenCalled();
    expect(mockProcess.generate).toHaveBeenCalled();
  });

  it('propagates initialization errors without sending a query', async () => {
    const startupError = new Error(
      'PyTorch process exited unexpectedly\nProcess stderr:\n' +
        'Runtime uses transformers 4.57.6; model requires transformers>=5.14.0',
    );
    vi.mocked(mockProcess.getCapabilities).mockRejectedValueOnce(startupError);

    const driver = createDriver({ mode: 'chat' });

    await expect(driver.query(prompt)).rejects.toThrow(startupError.message);
    expect(mockProcess.render).not.toHaveBeenCalled();
    expect(mockProcess.generate).not.toHaveBeenCalled();
  });

  it('uses generateMergedPrompt when chat template is unavailable', async () => {
    vi.mocked(mockProcess.getCapabilities).mockResolvedValue({
      ...mockCapabilities,
      features: { ...mockCapabilities.features, apply_chat_template: false },
    });

    const driver = createDriver({ mode: 'chat' });
    await driver.query(prompt);

    expect(mockProcess.render).not.toHaveBeenCalled();
    expect(mockProcess.generate).toHaveBeenCalledWith(
      expect.stringContaining('<!-- begin of USER -->'),
      expect.any(Object),
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('strips trustRemoteCode before generate after render', async () => {
    const driver = createDriver({ mode: 'chat' });
    await driver.query(prompt, { trustRemoteCode: true } as never);

    const generateOptions = vi.mocked(mockProcess.generate).mock.calls[0]?.[1];
    expect(generateOptions).not.toHaveProperty('trustRemoteCode');
  });

  it('prepares and uses a cache for VLM image requests in the cacheable prefix', async () => {
    vi.mocked(mockProcess.getCapabilities).mockResolvedValue({
      ...mockCapabilities,
      model_kind: 'vlm',
    });
    const imagePrompt: CompiledPrompt = {
      instructions: prompt.instructions,
      data: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this image' },
          { type: 'image_url', image_url: { url: 'image.png' } },
        ],
      }],
      output: [],
    };
    const cache = {
      bind: vi.fn().mockResolvedValue(undefined),
      shouldDisableForVlm: vi.fn().mockReturnValue(false),
      recordQuery: vi.fn(),
      getGrowthBefore: vi.fn().mockReturnValue(0),
      getWriteTokensSince: vi.fn().mockReturnValue(0),
      prepare: vi.fn().mockResolvedValue({
        ref: 'vision-cache',
        includes: { instructions: true, dataElementCount: 1, tools: false },
      }),
      readTokenCount: vi.fn().mockReturnValue(2),
      recordPromptTokens: vi.fn(),
      logStats: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const driver = new LocalInferenceDriver({
      model: 'test-vlm',
      process: mockProcess,
      adapters: createMockAdapters({
        extractImagePaths: (content) =>
          Array.isArray(content) ? ['image.png'] : [],
      }),
      cache,
      loggerPrefix: 'TEST',
    });

    await driver.query(imagePrompt);

    expect(cache.prepare).toHaveBeenCalledWith(expect.objectContaining({
      images: ['image.png'],
      maxImageSize: 768,
    }));
    expect(mockProcess.generate).toHaveBeenCalledWith(
      'rendered-prompt',
      expect.any(Object),
      expect.arrayContaining(['image.png']),
      768,
      'vision-cache',
      undefined,
    );
  });

  it('maps backend-reported cache usage into QueryResult.usage', async () => {
    mockProcess.generate = vi.fn().mockResolvedValue(
      Readable.from([
        `ok${META_MARKER}{"prompt_tokens":3,"generation_tokens":1,"cache_loaded":true,"cache_read_tokens":2,"cache_write_tokens":4}`,
      ]),
    );
    const driver = createDriver({ mode: 'chat' });

    const result = await driver.query(prompt, {
      cacheHandle: {
        ref: 'memory://prefix',
        includes: { instructions: true, dataElementCount: 0, tools: false },
      },
    });

    expect(result.usage).toMatchObject({
      promptTokens: 3,
      completionTokens: 1,
      totalTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 4,
    });
  });

  it('maps the terminal LIP generation token count into completion usage', async () => {
    mockProcess.generate = vi.fn().mockResolvedValue(
      Readable.from([
        'answer',
        ' continuation',
        `${META_MARKER}{"prompt_tokens":3,"generation_tokens":4}`,
      ]),
    );
    const driver = createDriver({ mode: 'chat' });

    const result = await driver.query(prompt);

    expect(result.usage).toMatchObject({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
    });
  });
});
