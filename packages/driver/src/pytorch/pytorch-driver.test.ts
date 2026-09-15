import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PyTorchDriver } from './pytorch-driver.js';

const pytorchMocks = vi.hoisted(() => {
  const capabilities = {
    methods: ['render', 'completion', 'format_test', 'capabilities', 'generate'],
    special_tokens: {
      eod: { text: '<|endoftext|>', id: 0 },
    },
    features: {
      apply_chat_template: false,
      vocab_size: 50257,
      model_max_length: 1024,
    },
  };

  return {
    capabilities,
    process: {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      getCapabilities: vi.fn().mockResolvedValue(capabilities),
      getStatus: vi.fn().mockReturnValue({ modelName: 'gpt2' }),
      render: vi.fn(),
      generate: vi.fn(),
      exit: vi.fn(),
    },
  };
});

vi.mock('./process/index.js', () => ({
  PyTorchProcess: vi.fn().mockImplementation(() => pytorchMocks.process),
}));

describe('PyTorchDriver', () => {
  beforeEach(() => {
    pytorchMocks.process.ensureInitialized.mockReset().mockResolvedValue(undefined);
    pytorchMocks.process.getCapabilities.mockReset().mockResolvedValue(pytorchMocks.capabilities);
    pytorchMocks.process.getStatus.mockReset().mockReturnValue({ modelName: 'gpt2' });
    pytorchMocks.process.render.mockReset();
    pytorchMocks.process.generate.mockReset();
    pytorchMocks.process.exit.mockReset();
  });

  it('should initialize and load capabilities', async () => {
    const driver = new PyTorchDriver({ model: 'gpt2' });

    // @ts-expect-error - private method for testing
    await driver.ensureInitialized();

    const capabilities = await driver.getCapabilities();
    expect(capabilities.methods).toContain('generate');
    expect(capabilities.features.vocabSize).toBe(50257);
  });

  it('propagates a runtime startup error through the query path', async () => {
    const startupError = new Error(
      'PyTorch process exited unexpectedly\nProcess stderr:\n' +
        'Runtime uses transformers 4.57.6; model requires transformers>=5.14.0',
    );
    pytorchMocks.process.getCapabilities.mockRejectedValueOnce(startupError);

    const driver = new PyTorchDriver({ model: 'Qwen/Qwen3.5-0.8B' });

    await expect(
      driver.query({ instructions: [], data: [], output: [] }),
    ).rejects.toThrow(startupError.message);
    expect(pytorchMocks.process.render).not.toHaveBeenCalled();
    expect(pytorchMocks.process.generate).not.toHaveBeenCalled();
  });
});
