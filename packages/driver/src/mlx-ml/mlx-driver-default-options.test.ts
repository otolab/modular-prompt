import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { MlxDriver } from './mlx-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';

const mockCapabilities = {
  methods: ['render', 'completion', 'format_test', 'capabilities', 'generate'],
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
  render: vi.fn().mockResolvedValue({ formatted_prompt: 'formatted', error: null }),
  completion: vi.fn(),
  generate: vi.fn(),
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
    mockProcess.render.mockResolvedValue({ formatted_prompt: 'formatted', error: null });
    mockProcess.generate.mockResolvedValue(createMockStream(['ok']));
  });

  it('does not pass mode to Python when set via defaultOptions', async () => {
    const driver = new MlxDriver({
      model: 'test-model',
      defaultOptions: { mode: 'instruct', maxTokens: 16 },
    });

    await driver.query(prompt);

    const generateOptions = mockProcess.generate.mock.calls[0]?.[1];
    expect(generateOptions).toEqual({ maxTokens: 16 });
    expect(generateOptions).not.toHaveProperty('mode');
  });

  it('uses defaultOptions.mode for API selection', async () => {
    const driver = new MlxDriver({
      model: 'test-model',
      defaultOptions: { mode: 'instruct' },
    });

    await driver.query(prompt);

    expect(mockProcess.generate).toHaveBeenCalled();
    expect(mockProcess.render).not.toHaveBeenCalled();
  });

  it('uses render + generate for chat API path', async () => {
    const driver = new MlxDriver({
      model: 'test-model',
      defaultOptions: { mode: 'chat' },
    });

    await driver.query(prompt);

    expect(mockProcess.render).toHaveBeenCalled();
    expect(mockProcess.generate).toHaveBeenCalled();
    expect(mockProcess.generate.mock.calls[0]?.[0]).toBe('formatted');
  });

  it('uses generateMergedPrompt when chat template is unavailable', async () => {
    mockProcess.getCapabilities.mockResolvedValue({
      ...mockCapabilities,
      features: {
        ...mockCapabilities.features,
        apply_chat_template: false,
      },
    });

    const driver = new MlxDriver({
      model: 'test-model',
      defaultOptions: { mode: 'chat' },
    });

    await driver.query(prompt);

    expect(mockProcess.render).not.toHaveBeenCalled();
    expect(mockProcess.generate).toHaveBeenCalled();
    expect(mockProcess.generate.mock.calls[0]?.[0]).toContain('<!-- begin of');
  });
});
