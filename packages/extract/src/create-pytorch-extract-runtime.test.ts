import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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
    PyTorchCacheController: class MockPyTorchCacheController {
      constructor(config: unknown) {
        cacheControllerCtor(config);
      }
      async close() {
        return cacheControllerClose();
      }
    },
  };
});

describe('createPytorchExtractRuntime', () => {
  beforeEach(() => {
    aiServiceFromMergedConfig.mockReset();
    aiServiceCreateDriver.mockReset();
    cacheControllerCtor.mockClear();
    cacheControllerClose.mockClear();
    mockDriver.getCapabilities.mockReset().mockResolvedValue({
      methods: {},
      specialTokens: {},
      features: { hasChatTemplate: true },
    });
    mockDriver.close.mockReset().mockResolvedValue(undefined);

    aiServiceFromMergedConfig.mockReturnValue({
      modelsConfig: {
        models: {
          local: {
            provider: 'pytorch',
            model: 'meta-llama/Llama-3.2-3B-Instruct',
            driverOptions: {
              device: 'cuda',
              venvPath: '/tmp/pytorch-venv',
              backend: 'vlm',
              maxImageSize: 512,
            },
          },
        },
      },
      createDriver: aiServiceCreateDriver,
    });
    aiServiceCreateDriver.mockResolvedValue(mockDriver);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bundles PyTorch cache and driver while preserving alias options', async () => {
    const { createPytorchExtractRuntime } = await import('./create-pytorch-extract-runtime.js');
    const runtime = await createPytorchExtractRuntime({
      model: 'local',
      cacheDir: '/tmp/extract-pytorch-runtime-test',
    });

    expect(cacheControllerCtor).toHaveBeenCalledWith({
      cacheDir: '/tmp/extract-pytorch-runtime-test',
    });
    expect(aiServiceCreateDriver).toHaveBeenCalledWith(expect.objectContaining({
      model: 'meta-llama/Llama-3.2-3B-Instruct',
      provider: 'pytorch',
      driverOptions: expect.objectContaining({
        device: 'cuda',
        venvPath: '/tmp/pytorch-venv',
        cacheController: expect.anything(),
      }),
    }));
    const driverSpec = aiServiceCreateDriver.mock.calls[0]?.[0] as {
      driverOptions?: Record<string, unknown>;
    };
    expect(driverSpec.driverOptions).not.toHaveProperty('backend');
    expect(driverSpec.driverOptions).not.toHaveProperty('maxImageSize');
    expect(runtime.provider).toBe('pytorch');
    expect(runtime.model).toBe('meta-llama/Llama-3.2-3B-Instruct');
    expect(mockDriver.getCapabilities).toHaveBeenCalledOnce();

    await runtime.close();
    expect(mockDriver.close).toHaveBeenCalledOnce();
    expect(cacheControllerClose).toHaveBeenCalledOnce();
  });

  it('closes the cache when capabilities fail and preserves the original error', async () => {
    const { createPytorchExtractRuntime } = await import('./create-pytorch-extract-runtime.js');
    const capabilitiesError = new Error('PyTorch capabilities unavailable');
    mockDriver.getCapabilities.mockRejectedValueOnce(capabilitiesError);
    cacheControllerClose.mockRejectedValueOnce(new Error('cache close failed'));

    await expect(createPytorchExtractRuntime({ model: 'local' })).rejects.toBe(capabilitiesError);
    expect(mockDriver.close).toHaveBeenCalledOnce();
    expect(cacheControllerClose).toHaveBeenCalledOnce();
  });
});
