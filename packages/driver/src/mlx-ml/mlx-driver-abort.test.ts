import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { MlxDriver } from './mlx-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';

const META_MARKER = '\x1e__META__:';

function createMockStream(chunks: string[]): Readable {
  return Readable.from(chunks);
}

const mockCapabilities = {
  methods: ['chat', 'completion', 'format_test', 'capabilities'],
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

const mockProcess = {
  ensureInitialized: vi.fn().mockResolvedValue(undefined),
  getCapabilities: vi.fn().mockResolvedValue(mockCapabilities),
  chat: vi.fn(),
  completion: vi.fn(),
  cancelActiveRequest: vi.fn(),
  exit: vi.fn(),
};

vi.mock('./process/index.js', () => ({
  MlxProcess: vi.fn().mockImplementation(() => mockProcess),
}));

const prompt: CompiledPrompt = {
  instructions: [{ type: 'text', content: 'Hello' }],
  data: [],
  output: [],
};

describe('MlxDriver abort signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.getCapabilities.mockResolvedValue(mockCapabilities);
    mockProcess.chat.mockResolvedValue(
      createMockStream(['partial ', `answer${META_MARKER}{"prompt_tokens":10,"generation_tokens":3}`]),
    );
  });

  it('returns immediately when signal is already aborted', async () => {
    const driver = new MlxDriver({ model: 'test-model' });
    const controller = new AbortController();
    controller.abort();

    const { stream, result } = await driver.streamQuery(prompt, { signal: controller.signal });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
    await expect(result).resolves.toMatchObject({
      content: '',
      finishReason: 'error',
    });
    expect(mockProcess.chat).not.toHaveBeenCalled();
  });

  it('invokes cancelActiveRequest when aborted during stream', async () => {
    const driver = new MlxDriver({ model: 'test-model' });
    const controller = new AbortController();

    mockProcess.chat.mockResolvedValue(createMockStream(['partial ']));

    const { stream } = await driver.streamQuery(prompt, { signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();

    expect(mockProcess.cancelActiveRequest).toHaveBeenCalled();
  });

  it('includes usage with token counts from stream meta', async () => {
    const driver = new MlxDriver({ model: 'test-model' });
    const { stream, result } = await driver.streamQuery(prompt);

    for await (const _chunk of stream) {
      // consume
    }

    await expect(result).resolves.toMatchObject({
      usage: {
        promptTokens: 10,
        completionTokens: 3,
        totalTokens: 13,
      },
      finishReason: 'stop',
    });
  });
});
