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
});
