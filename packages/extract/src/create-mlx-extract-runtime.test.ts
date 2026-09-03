import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const aiServiceFromMergedConfig = vi.fn();
const aiServiceCreateDriver = vi.fn();
const cacheControllerCtor = vi.fn();
const cacheControllerClose = vi.fn();
const mockDriver = {
  getCapabilities: vi.fn(async () => ({
    supportsTools: false,
    supportsStructuredOutput: false,
    modelMaxLength: 4096,
  })),
  close: vi.fn(async () => {}),
};

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
        cacheControllerClose();
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
    mockDriver.getCapabilities.mockClear();
    mockDriver.close.mockClear();

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
});
