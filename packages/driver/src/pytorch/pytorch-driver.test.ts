import { describe, it, expect, vi } from 'vitest';
import { PyTorchDriver } from './pytorch-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';

const CUDA_UNAVAILABLE_ERROR =
  'CUDA device requested, but CUDA is not available in this PyTorch runtime. ' +
  'Install a CUDA-enabled torch wheel and verify the NVIDIA driver.';

vi.mock('./process/index.js', () => ({
  PyTorchProcess: vi.fn().mockImplementation(() => ({
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue({
      methods: ['render', 'completion', 'format_test', 'capabilities', 'generate'],
      special_tokens: {
        eod: { text: '<|endoftext|>', id: 0 },
      },
      features: {
        apply_chat_template: false,
        vocab_size: 50257,
        model_max_length: 1024,
      },
    }),
    getStatus: vi.fn().mockReturnValue({ modelName: 'gpt2' }),
    render: vi.fn(),
    generate: vi.fn(),
    exit: vi.fn(),
  })),
}));

describe('PyTorchDriver', () => {
  it('should initialize and load capabilities', async () => {
    const driver = new PyTorchDriver({ model: 'gpt2' });

    // @ts-expect-error - private method for testing
    await driver.ensureInitialized();

    const capabilities = await driver.getCapabilities();
    expect(capabilities.methods).toContain('generate');
    expect(capabilities.features.vocabSize).toBe(50257);
  });

  it('rejects a CUDA-specific initialization error from getCapabilities', async () => {
    const driver = new PyTorchDriver({ model: 'gpt2' });
    const process = (driver as unknown as {
      process: { getCapabilities: ReturnType<typeof vi.fn> };
    }).process;
    process.getCapabilities.mockRejectedValueOnce(new Error(CUDA_UNAVAILABLE_ERROR));

    await expect(driver.getCapabilities()).rejects.toThrow(CUDA_UNAVAILABLE_ERROR);
  });

  it('rejects a CUDA-specific initialization error before the first query', async () => {
    const driver = new PyTorchDriver({ model: 'gpt2' });
    const process = (driver as unknown as {
      process: {
        getCapabilities: ReturnType<typeof vi.fn>;
        generate: ReturnType<typeof vi.fn>;
      };
    }).process;
    process.getCapabilities.mockRejectedValueOnce(new Error(CUDA_UNAVAILABLE_ERROR));

    const prompt: CompiledPrompt = {
      instructions: [],
      data: [],
      output: [],
    };
    await expect(driver.query(prompt)).rejects.toThrow(CUDA_UNAVAILABLE_ERROR);
    expect(process.generate).not.toHaveBeenCalled();
  });
});
