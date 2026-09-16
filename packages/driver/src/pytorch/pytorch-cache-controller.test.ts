import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PyTorchCacheController } from './pytorch-cache-controller.js';

function createMockProcess() {
  return {
    tokenize: vi.fn().mockResolvedValue({
      token_ids: [1, 2, 3, 4],
      token_count: 4,
      error: null,
    }),
    cachePrefill: vi.fn().mockResolvedValue({
      token_count: 4,
      cache_write_tokens: 4,
    }),
  };
}

function createPersistentMockProcess() {
  return {
    tokenize: vi.fn().mockResolvedValue({
      token_ids: [1, 2, 3, 4],
      token_count: 4,
      error: null,
    }),
    cachePrefill: vi.fn().mockImplementation(async (
      cachePath: string,
      _messages: unknown[],
      baseCachePath?: string,
      _trimToTokens?: number,
      prefixOffsets?: number[],
      prefixHashes?: string[],
    ) => {
      writeFileSync(cachePath, 'pytorch-cache');
      writeFileSync(
        `${cachePath}.meta.json`,
        JSON.stringify({
          layout: 'pytorch_kv_v1',
          token_count: 4,
          prefix_offsets: prefixOffsets ?? [],
          prefix_hashes: prefixHashes ?? [],
        }),
      );
      return {
        cache_path: cachePath,
        token_count: 4,
        cache_write_tokens: baseCachePath ? 0 : 4,
      };
    }),
  };
}

describe('PyTorchCacheController', () => {
  let process: ReturnType<typeof createMockProcess>;
  let controller: PyTorchCacheController;

  beforeEach(async () => {
    process = createMockProcess();
    controller = new PyTorchCacheController();
    await controller.bind(process as never, {});
  });

  afterEach(async () => {
    await controller.close();
  });

  it('prefills a PyTorch cache and exposes the backend token count', async () => {
    const handle = await controller.prepare({
      model: 'test-model',
      instructions: [{ type: 'text', content: 'Be helpful' }],
    });

    expect(handle.ref).toMatch(/\.pytorch-cache$/);
    expect(handle.includes).toEqual({
      instructions: true,
      dataElementCount: 0,
      tools: false,
    });
    expect(controller.readCacheTokenCount(handle.ref)).toBe(4);
    expect(controller.getStats()).toMatchObject({
      fresh: 1,
      cacheGrowthTokens: 4,
    });
    expect(process.cachePrefill).toHaveBeenCalledOnce();
  });

  it('reuses an identical cache in memory', async () => {
    const params = {
      model: 'test-model',
      instructions: [{ type: 'text' as const, content: 'same prompt' }],
    };

    const first = await controller.prepare(params);
    const second = await controller.prepare(params);

    expect(second.ref).toBe(first.ref);
    expect(process.cachePrefill).toHaveBeenCalledOnce();
    expect(controller.getStats().memoryHit).toBe(1);
  });

  it('coalesces concurrent prepares for the same cache key', async () => {
    let resolvePrefill: ((value: { token_count: number }) => void) | undefined;
    process.cachePrefill.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePrefill = resolve;
      }),
    );

    const params = {
      model: 'test-model',
      instructions: [{ type: 'text' as const, content: 'concurrent' }],
    };
    const firstPromise = controller.prepare(params);
    const secondPromise = controller.prepare(params);
    await new Promise<void>((resolve) => setImmediate(resolve));
    resolvePrefill?.({ token_count: 4 });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.ref).toBe(second.ref);
    expect(process.cachePrefill).toHaveBeenCalledOnce();
  });

  it('passes converted tools and reasoning effort to cachePrefill', async () => {
    await controller.prepare({
      model: 'test-model',
      instructions: [{ type: 'text', content: 'Use tools' }],
      tools: [{ name: 'lookup', description: 'Look something up', parameters: {} }],
      reasoningEffort: 'high',
    });

    const call = process.cachePrefill.mock.calls[0];
    expect(call?.[6]).toEqual([{
      type: 'function',
      function: {
        name: 'lookup',
        description: 'Look something up',
        parameters: {},
      },
    }]);
    expect(call?.[7]).toBe('high');
  });

  it('returns an empty handle for a read-only cache miss', async () => {
    const handle = await controller.prepare({
      model: 'test-model',
      instructions: [{ type: 'text', content: 'missing' }],
      readOnly: true,
    });

    expect(handle.ref).toBe('');
    expect(process.cachePrefill).not.toHaveBeenCalled();
  });

  it('returns an empty handle when prefill fails', async () => {
    process.cachePrefill.mockRejectedValueOnce(new Error('backend unavailable'));

    const handle = await controller.prepare({
      model: 'test-model',
      instructions: [{ type: 'text', content: 'will fail' }],
    });

    expect(handle.ref).toBe('');
  });

  it('falls back to plain prefill for a runtime without prefix metadata support', async () => {
    process.cachePrefill
      .mockRejectedValueOnce(new Error('PyTorch LIP backend does not support cache prefix metadata in Phase 1'))
      .mockResolvedValueOnce({ token_count: 4, cache_write_tokens: 4 });

    const handle = await controller.prepare({
      model: 'test-model',
      instructions: [{ type: 'text', content: 'CUDA-compatible' }],
    });

    expect(handle.ref).toMatch(/\.pytorch-cache$/);
    expect(process.cachePrefill).toHaveBeenCalledTimes(2);
    expect(process.cachePrefill.mock.calls[1]?.slice(2, 6)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('uses a fixed cache directory and preserves it on close', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'pytorch-cache-controller-test-'));
    const fixedController = new PyTorchCacheController({ cacheDir });
    try {
      await fixedController.bind(process as never, {});
      const handle = await fixedController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'fixed' }],
      });

      expect(handle.ref).toContain(cacheDir);
      expect(handle.ref).toMatch(/\.pytorch-cache$/);
      await fixedController.close();
      expect(existsSync(cacheDir)).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('reuses a persistent cache after controller restart', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'pytorch-cache-restart-test-'));
    const params = {
      model: 'test-model',
      instructions: [{ type: 'text' as const, content: 'restartable' }],
    };
    const firstProcess = createPersistentMockProcess();
    const first = new PyTorchCacheController({ cacheDir });
    let firstHandle: { ref: string } | undefined;
    try {
      await first.bind(firstProcess as never, {});
      firstHandle = await first.prepare(params);
      await first.close();

      const secondProcess = createPersistentMockProcess();
      const second = new PyTorchCacheController({ cacheDir });
      try {
        await second.bind(secondProcess as never, {});
        const secondHandle = await second.prepare({ ...params, readOnly: true });

        expect(secondHandle.ref).toBe(firstHandle.ref);
        expect(secondProcess.cachePrefill).not.toHaveBeenCalled();
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('does not reuse a released cache after prepare with a fixed cache directory', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'pytorch-cache-release-test-'));
    const params = {
      model: 'test-model',
      instructions: [{ type: 'text' as const, content: 'released' }],
    };
    const persistentProcess = createPersistentMockProcess();
    const releaseController = new PyTorchCacheController({ cacheDir });
    try {
      await releaseController.bind(persistentProcess as never, {});
      const first = await releaseController.prepare(params);
      releaseController.release(first.ref);

      const second = await releaseController.prepare(params);

      expect(second.ref).not.toBe(first.ref);
      expect(persistentProcess.cachePrefill).toHaveBeenCalledTimes(2);
      expect(persistentProcess.cachePrefill.mock.calls[1]?.[0]).toBe(second.ref);

      releaseController.release(second.ref);
      await releaseController.prepare({
        ...params,
        data: [{ type: 'text', content: 'new suffix' }],
      });

      expect(persistentProcess.cachePrefill).toHaveBeenCalledTimes(3);
      expect(persistentProcess.cachePrefill.mock.calls[2]?.[2]).toBeUndefined();
    } finally {
      await releaseController.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('passes a compatible persistent cache as the incremental prefill base', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'pytorch-cache-incremental-test-'));
    const persistentProcess = createPersistentMockProcess();
    const incrementalController = new PyTorchCacheController({ cacheDir });
    try {
      await incrementalController.bind(persistentProcess as never, {});
      const first = await incrementalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'stable prefix' }],
      });
      await incrementalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'stable prefix' }],
        data: [{ type: 'text', content: 'new data' }],
      });

      expect(persistentProcess.cachePrefill).toHaveBeenCalledTimes(2);
      const secondCall = persistentProcess.cachePrefill.mock.calls[1];
      expect(secondCall?.[2]).toBe(first.ref);
      expect(secondCall?.[3]).toBe(4);
      expect(incrementalController.getStats()).toMatchObject({ incremental: 1 });
    } finally {
      await incrementalController.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('rejects prepare before bind and empty cacheable content', async () => {
    const unbound = new PyTorchCacheController();
    await expect(unbound.prepare({ model: 'test-model' })).rejects.toThrow(
      'PyTorchCacheController is not bound to a process',
    );

    await expect(controller.prepare({ model: 'test-model' })).rejects.toThrow(
      'Cannot prepare cache with no cacheable content',
    );
  });

  it('rejects binding the same controller twice', async () => {
    await expect(controller.bind(process as never, {})).rejects.toThrow(
      'PyTorchCacheController is already bound to a process',
    );
  });
});
