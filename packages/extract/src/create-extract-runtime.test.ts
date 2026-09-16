import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getUserModelsConfigPath } from '@modular-prompt/driver';

const { createMlxRuntimeMock, createPytorchRuntimeMock } = vi.hoisted(() => ({
  createMlxRuntimeMock: vi.fn(),
  createPytorchRuntimeMock: vi.fn(),
}));

vi.mock('./create-mlx-extract-runtime.js', () => ({
  createMlxExtractRuntime: createMlxRuntimeMock,
}));

vi.mock('./create-pytorch-extract-runtime.js', () => ({
  createPytorchExtractRuntime: createPytorchRuntimeMock,
}));

describe('createExtractRuntime', () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-extract-runtime-'));
    previousHome = process.env.MODULAR_PROMPT_HOME;
    process.env.MODULAR_PROMPT_HOME = tempHome;
    createMlxRuntimeMock.mockReset().mockResolvedValue({ provider: 'mlx' });
    createPytorchRuntimeMock.mockReset().mockResolvedValue({ provider: 'pytorch' });
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.MODULAR_PROMPT_HOME;
    } else {
      process.env.MODULAR_PROMPT_HOME = previousHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('selects PyTorch from an alias and passes the original alias through', async () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  local-pytorch:
    provider: pytorch
    model: meta-llama/Llama-3.2-3B-Instruct
`,
    );

    const { createExtractRuntime } = await import('./create-extract-runtime.js');
    await createExtractRuntime({
      model: 'local-pytorch',
      cacheDir: '/tmp/pytorch-extract-store',
    });

    expect(createPytorchRuntimeMock).toHaveBeenCalledWith({
      model: 'local-pytorch',
      cacheDir: '/tmp/pytorch-extract-store',
    });
    expect(createMlxRuntimeMock).not.toHaveBeenCalled();
  });

  it('uses an explicit provider for a raw model ID and ignores MLX-only options', async () => {
    const { createExtractRuntime } = await import('./create-extract-runtime.js');
    await createExtractRuntime({
      model: 'meta-llama/Llama-3.2-3B-Instruct',
      provider: 'pytorch',
      backend: 'vlm',
      maxImageSize: 512,
    });

    expect(createPytorchRuntimeMock).toHaveBeenCalledWith({
      model: 'meta-llama/Llama-3.2-3B-Instruct',
    });
  });
});
