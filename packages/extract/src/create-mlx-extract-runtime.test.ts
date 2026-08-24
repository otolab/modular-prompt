import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mlxDriverCtor = vi.fn();

vi.mock('@modular-prompt/driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modular-prompt/driver')>();
  return {
    ...actual,
    MlxDriver: class MockMlxDriver {
      constructor(config: unknown) {
        mlxDriverCtor(config);
      }
      async getCapabilities() {
        return {
          supportsTools: false,
          supportsStructuredOutput: false,
          modelMaxLength: 4096,
        };
      }
      async close() {}
    },
    MlxCacheController: class MockMlxCacheController {
      async close() {}
    },
  };
});

describe('createMlxExtractRuntime', () => {
  beforeEach(() => {
    mlxDriverCtor.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forces mlx-lm backend for prompt cache compatibility', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    await createMlxExtractRuntime({ model: 'test-model' });

    expect(mlxDriverCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        backend: 'lm',
      }),
    );
  });
});
