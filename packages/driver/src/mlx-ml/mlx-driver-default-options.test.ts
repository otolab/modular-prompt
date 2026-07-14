import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { MlxDriver } from './mlx-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';

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
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('./process/index.js', () => ({
  MlxProcess: vi.fn().mockImplementation(() => mockProcess),
}));

function createMockStream(chunks: string[]): Readable {
  return Readable.from(chunks);
}

const prompt: CompiledPrompt = {
  instructions: [{ type: 'text', content: 'test' }],
  data: [],
  output: [],
};

describe('MlxDriver defaultOptions.mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.chat.mockResolvedValue(createMockStream(['ok']));
    mockProcess.completion.mockResolvedValue(createMockStream(['ok']));
  });

  it('does not pass mode to Python when set via defaultOptions', async () => {
    const driver = new MlxDriver({
      model: 'test-model',
      defaultOptions: { mode: 'instruct', maxTokens: 16 },
    });

    await driver.query(prompt);

    const completionOptions = mockProcess.completion.mock.calls[0]?.[1];
    expect(completionOptions).toEqual({ maxTokens: 16 });
    expect(completionOptions).not.toHaveProperty('mode');
  });

  it('uses defaultOptions.mode for API selection', async () => {
    const driver = new MlxDriver({
      model: 'test-model',
      defaultOptions: { mode: 'instruct' },
    });

    await driver.query(prompt);

    expect(mockProcess.completion).toHaveBeenCalled();
    expect(mockProcess.chat).not.toHaveBeenCalled();
  });
});
