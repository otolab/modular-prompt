import { describe, expect, it, vi } from 'vitest';
import type { PromptCacheController } from '../cache-controller.js';

const mlxDriverCtor = vi.fn();

vi.mock('../mlx-ml/mlx-driver.js', () => ({
  MlxDriver: class MockMlxDriver {
    constructor(config: unknown) {
      mlxDriverCtor(config);
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
