import { describe, it, expect, vi } from 'vitest';
import { PyTorchDriver } from './pytorch-driver.js';

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
});
