import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  aiServiceFromMergedConfig,
  aiServiceCreateDriver,
  cacheControllerCtor,
  cacheControllerClose,
  mockDriver,
} = vi.hoisted(() => ({
  aiServiceFromMergedConfig: vi.fn(),
  aiServiceCreateDriver: vi.fn(),
  cacheControllerCtor: vi.fn(),
  cacheControllerClose: vi.fn(),
  mockDriver: {
    getCapabilities: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('@modular-prompt/driver', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    AIService: {
      fromMergedConfig: aiServiceFromMergedConfig,
    },
    MlxCacheController: class MockMlxCacheController {
      constructor(config: unknown) {
        cacheControllerCtor(config);
      }
      async close() {
        return cacheControllerClose();
      }
    },
  };
});

describe('createMlxExtractRuntime', () => {
  beforeEach(() => {
    aiServiceFromMergedConfig.mockReset();
    aiServiceCreateDriver.mockReset();
    cacheControllerCtor.mockClear();
    cacheControllerClose.mockClear();
    mockDriver.getCapabilities.mockReset().mockResolvedValue({
      supportsTools: false,
      supportsStructuredOutput: false,
      modelMaxLength: 4096,
    });
    mockDriver.close.mockReset().mockResolvedValue(undefined);

    aiServiceFromMergedConfig.mockReturnValue({
      modelsConfig: {
        models: {
          default: { provider: 'mlx', model: 'resolved/model' },
        },
      },
      createDriver: aiServiceCreateDriver,
    });
    aiServiceCreateDriver.mockResolvedValue(mockDriver);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the model through AIService and forces mlx-lm backend', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    const runtime = await createMlxExtractRuntime({
      model: 'default',
      cacheDir: '/tmp/extract-runtime-test',
    });

    expect(aiServiceFromMergedConfig).toHaveBeenCalled();
    expect(aiServiceCreateDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'resolved/model',
        backend: 'lm',
        driverOptions: expect.objectContaining({
          backend: 'lm',
          cacheController: expect.anything(),
        }),
      }),
    );
    expect(runtime.model).toBe('resolved/model');
    expect(mockDriver.getCapabilities).toHaveBeenCalledOnce();

    await runtime.close();
    expect(cacheControllerClose).toHaveBeenCalledOnce();
  });

  it('closes the driver and cache when capabilities fail, preserving the original error', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    const capabilitiesError = new Error('capabilities unavailable');
    mockDriver.getCapabilities.mockRejectedValueOnce(capabilitiesError);
    cacheControllerClose.mockRejectedValueOnce(new Error('cache close failed'));

    await expect(createMlxExtractRuntime({ model: 'default' })).rejects.toBe(capabilitiesError);
    expect(mockDriver.close).toHaveBeenCalledOnce();
    expect(cacheControllerClose).toHaveBeenCalledOnce();
  });

  it('closes the cache when driver creation fails, preserving the original error', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    const creationError = new Error('driver creation failed');
    aiServiceCreateDriver.mockRejectedValueOnce(creationError);
    cacheControllerClose.mockRejectedValueOnce(new Error('cache close failed'));

    await expect(createMlxExtractRuntime({ model: 'default' })).rejects.toBe(creationError);
    expect(mockDriver.close).not.toHaveBeenCalled();
    expect(cacheControllerClose).toHaveBeenCalledOnce();
  });
});
