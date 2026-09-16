import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { PyTorchDriver } from './pytorch-driver.js';
import { PyTorchCacheController } from './pytorch-cache-controller.js';
import type { CompiledPrompt } from '@modular-prompt/core';

const CUDA_UNAVAILABLE_ERROR =
  'CUDA device requested, but CUDA is not available in this PyTorch runtime. ' +
  'Install a CUDA-enabled torch wheel and verify the NVIDIA driver.';

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
      tokenize: vi.fn(),
      cachePrefill: vi.fn(),
      generate: vi.fn(),
      cancelActiveRequest: vi.fn(),
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
    pytorchMocks.process.tokenize.mockReset();
    pytorchMocks.process.cachePrefill.mockReset();
    pytorchMocks.process.generate.mockReset();
    pytorchMocks.process.cancelActiveRequest.mockReset();
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

  it('rejects a CUDA-specific initialization error from getCapabilities', async () => {
    const driver = new PyTorchDriver({ model: 'gpt2' });
    pytorchMocks.process.getCapabilities.mockRejectedValueOnce(new Error(CUDA_UNAVAILABLE_ERROR));

    await expect(driver.getCapabilities()).rejects.toThrow(CUDA_UNAVAILABLE_ERROR);
  });

  it('rejects a CUDA-specific initialization error before the first query', async () => {
    const driver = new PyTorchDriver({ model: 'gpt2' });
    pytorchMocks.process.getCapabilities.mockRejectedValueOnce(new Error(CUDA_UNAVAILABLE_ERROR));

    const prompt: CompiledPrompt = {
      instructions: [],
      data: [],
      output: [],
    };
    await expect(driver.query(prompt)).rejects.toThrow(CUDA_UNAVAILABLE_ERROR);
    expect(pytorchMocks.process.generate).not.toHaveBeenCalled();
  });

  it('binds PyTorchCacheController and maps cache usage through the query result', async () => {
    const cacheController = new PyTorchCacheController();
    const driver = new PyTorchDriver({
      model: 'gpt2',
      cacheController,
    });
    pytorchMocks.process.getCapabilities.mockResolvedValueOnce({
      ...pytorchMocks.capabilities,
      methods: [...pytorchMocks.capabilities.methods, 'cache_prefill'],
      model_kind: 'lm',
      features: {
        ...pytorchMocks.capabilities.features,
        apply_chat_template: true,
        chat_template: {
          supported_roles: ['system', 'user', 'assistant'],
          constraints: {},
        },
      },
    });
    pytorchMocks.process.render.mockResolvedValue({
      formatted_prompt: 'rendered-prompt',
      error: null,
    });
    pytorchMocks.process.tokenize.mockResolvedValue({
      token_ids: [1, 2, 3],
      token_count: 3,
      error: null,
    });
    pytorchMocks.process.cachePrefill.mockResolvedValue({
      token_count: 3,
      cache_write_tokens: 3,
    });
    pytorchMocks.process.generate.mockResolvedValue(
      Readable.from([
        'answer\x1e__META__:{"prompt_tokens":5,"generation_tokens":2,"cache_loaded":true,"cache_read_tokens":3,"cache_write_tokens":3}',
      ]),
    );

    const result = await driver.query({
      instructions: [{ type: 'text', content: 'System prompt' }],
      data: [],
      output: [],
    }, { cache: true });

    expect(result.content).toBe('answer');
    expect(result.usage).toMatchObject({
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 3,
    });
    expect(pytorchMocks.process.cachePrefill).toHaveBeenCalledOnce();
    expect(pytorchMocks.process.generate).toHaveBeenCalledWith(
      'rendered-prompt',
      expect.any(Object),
      undefined,
      undefined,
      expect.stringContaining('.pytorch-cache'),
      undefined,
    );

    await driver.close();
  });
});
