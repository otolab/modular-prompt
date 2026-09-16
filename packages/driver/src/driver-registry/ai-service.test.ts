import { describe, expect, it, vi } from 'vitest';
import type { PromptCacheController } from '../cache-controller.js';
import { PyTorchCacheController } from '../pytorch/pytorch-cache-controller.js';

const mlxDriverCtor = vi.fn();
const pytorchDriverCtor = vi.fn();

vi.mock('../mlx-ml/mlx-driver.js', () => ({
  MlxDriver: class MockMlxDriver {
    constructor(config: unknown) {
      mlxDriverCtor(config);
    }
  },
}));

vi.mock('../pytorch/pytorch-driver.js', () => ({
  PyTorchDriver: class MockPyTorchDriver {
    constructor(config: unknown) {
      pytorchDriverCtor(config);
    }
  },
}));

import { AIService } from './ai-service.js';

describe('AIService MLX factory', () => {
  it('passes a runtime cache controller through ModelSpec driverOptions', async () => {
    const cacheController = {} as PromptCacheController;
    const service = AIService.fromApplicationConfig({ models: [] });

    await service.createDriver({
      model: 'test-model',
      provider: 'mlx',
      capabilities: [],
      backend: 'lm',
      driverOptions: {
        backend: 'lm',
        cacheController,
      },
    });

    expect(mlxDriverCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        backend: 'lm',
        cacheController,
      }),
    );
  });
});

describe('AIService PyTorch factory', () => {
  it('creates a PyTorch cache controller from driverOptions.cacheDir', async () => {
    const service = AIService.fromApplicationConfig({ models: [] });

    await service.createDriver({
      model: 'test-model',
      provider: 'pytorch',
      capabilities: [],
      driverOptions: {
        cacheDir: '/tmp/pytorch-cache',
      },
    });

    expect(pytorchDriverCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        cacheController: expect.any(PyTorchCacheController),
      }),
    );
  });

  it('passes a supplied PyTorch cache controller through driverOptions', async () => {
    const cacheController = {} as PromptCacheController;
    const service = AIService.fromApplicationConfig({ models: [] });

    await service.createDriver({
      model: 'test-model',
      provider: 'pytorch',
      capabilities: [],
      driverOptions: {
        cacheController,
      },
    });

    expect(pytorchDriverCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        cacheController,
      }),
    );
  });
});
