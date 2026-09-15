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

  it('preserves a configured VLM backend for extract', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    aiServiceFromMergedConfig.mockReturnValueOnce({
      modelsConfig: {
        models: {
          default: {
            provider: 'mlx',
            model: 'resolved/vlm-model',
            driverOptions: { backend: 'vlm' },
          },
        },
      },
      createDriver: aiServiceCreateDriver,
    });
    const runtime = await createMlxExtractRuntime({
      model: 'default',
      cacheDir: '/tmp/extract-runtime-test',
    });

    expect(aiServiceFromMergedConfig).toHaveBeenCalled();
    expect(aiServiceCreateDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'resolved/vlm-model',
        backend: 'vlm',
        driverOptions: expect.objectContaining({
          backend: 'vlm',
          cacheController: expect.anything(),
        }),
      }),
    );
    expect(runtime.model).toBe('resolved/vlm-model');
    expect(runtime.backend).toBe('vlm');
    expect(mockDriver.getCapabilities).toHaveBeenCalledOnce();

    await runtime.close();
    expect(cacheControllerClose).toHaveBeenCalledOnce();
  });

  it('propagates the VLM image resize limit to the driver and runtime', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    const runtime = await createMlxExtractRuntime({
      model: 'default',
      maxImageSize: 512,
    });

    expect(aiServiceCreateDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        driverOptions: expect.objectContaining({ maxImageSize: 512 }),
      }),
    );
    expect(runtime.maxImageSize).toBe(512);

    await runtime.close();
  });

  it('defaults extract MLX models to backend auto', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    const runtime = await createMlxExtractRuntime({ model: 'default' });

    expect(aiServiceCreateDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'auto',
        driverOptions: expect.objectContaining({
          backend: 'auto',
          cacheController: expect.anything(),
        }),
      }),
    );
    expect(runtime.backend).toBe('auto');

    await runtime.close();
  });

  it('lets a persisted backend override a changed model configuration', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    const runtime = await createMlxExtractRuntime({
      model: 'mlx-community/raw-vlm-model',
      backend: 'vlm',
    });

    expect(aiServiceCreateDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mlx-community/raw-vlm-model',
        backend: 'vlm',
        driverOptions: expect.objectContaining({ backend: 'vlm' }),
      }),
    );
    expect(runtime.backend).toBe('vlm');

    await runtime.close();
  });

  it('fails before driver creation when no model is configured', async () => {
    const { createMlxExtractRuntime } = await import('./create-mlx-extract-runtime.js');
    aiServiceFromMergedConfig.mockReturnValue({
      modelsConfig: {},
      createDriver: aiServiceCreateDriver,
    });

    await expect(createMlxExtractRuntime({})).rejects.toThrow(
      'No model configured: specify -m <model-id-or-alias> or define models.default '
      + 'in ~/.modular-prompt/models.yaml',
    );
    expect(aiServiceCreateDriver).not.toHaveBeenCalled();
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
