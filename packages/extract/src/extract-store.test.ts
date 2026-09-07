import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestDriver, type PromptCacheController } from '@modular-prompt/driver';
import { createMockCacheController } from './test-helpers.js';
import { createExtractSession } from './create-extract-session.js';
import {
  appendToExtractStore,
  mergeMaterials,
} from './extract-store.js';
import { writeManifest } from './cli/manifest.js';

const { createRuntimeMock } = vi.hoisted(() => ({
  createRuntimeMock: vi.fn(),
}));

vi.mock('./create-mlx-extract-runtime.js', () => ({
  createMlxExtractRuntime: createRuntimeMock,
}));

describe('mergeMaterials', () => {
  it('appends new materials and skips identical ids', () => {
    const existing = [{ id: '/docs/one.txt', title: 'one.txt', content: 'one' }];
    const incoming = [
      { id: '/docs/one.txt', title: 'one.txt', content: 'one' },
      { id: '/docs/two.txt', title: 'two.txt', content: 'two' },
    ];

    expect(mergeMaterials(existing, incoming)).toEqual([
      existing[0],
      incoming[1],
    ]);
  });

  it('rejects changed content for an existing id', () => {
    expect(() => mergeMaterials(
      [{ id: '/docs/one.txt', title: 'one.txt', content: 'old' }],
      [{ id: '/docs/one.txt', title: 'one.txt', content: 'new' }],
    )).toThrow(/content differs.*duplicate id/);
  });
});

describe('appendToExtractStore', () => {
  let tempDir: string;
  let tracking: ReturnType<typeof createMockCacheController>;
  const runtimeClose = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-store-'));
    tracking = createMockCacheController();
    runtimeClose.mockReset().mockResolvedValue(undefined);
    createRuntimeMock.mockReset().mockImplementation(async () => ({
      driver: new TestDriver({ responses: ['prepared'] }),
      cacheController: tracking.controller,
      model: 'test-model',
      close: runtimeClose,
    }));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('runs prepare against the merged corpus and records updatedAt', async () => {
    const storeDir = join(tempDir, 'meeting');
    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, 'old-cache.safetensors.zip'), 'old-cache', 'utf-8');
    await writeManifest(storeDir, {
      version: 1,
      storename: 'meeting',
      model: 'test-model',
      materials: [{ id: '/docs/one.txt', title: 'one.txt', content: 'one' }],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await appendToExtractStore({
      storeDir,
      storename: 'meeting',
      incomingMaterials: [{ id: '/docs/two.txt', title: 'two.txt', content: 'two' }],
      now: () => '2026-09-07T00:00:00.000Z',
    });

    expect(result.manifest.materials).toHaveLength(2);
    expect(result.manifest.updatedAt).toBe('2026-09-07T00:00:00.000Z');
    expect(tracking.prepares).toHaveLength(1);
    expect(JSON.stringify(tracking.prepares[0]?.data)).toContain('one');
    expect(JSON.stringify(tracking.prepares[0]?.data)).toContain('two');
    expect(runtimeClose).toHaveBeenCalledOnce();
    expect(await readFile(join(storeDir, 'manifest.json'), 'utf-8'))
      .toContain('2026-09-07T00:00:00.000Z');
  });

  it('rejects an empty required cache handle and preserves the existing store', async () => {
    const storeDir = join(tempDir, 'meeting');
    const oldCachePath = join(storeDir, 'old-cache.safetensors.zip');
    const oldCacheMetaPath = `${oldCachePath}.meta.json`;
    await mkdir(storeDir, { recursive: true });
    await writeFile(oldCachePath, 'old-cache', 'utf-8');
    await writeFile(oldCacheMetaPath, JSON.stringify({ token_count: 42 }), 'utf-8');
    await writeManifest(storeDir, {
      version: 1,
      storename: 'meeting',
      model: 'test-model',
      materials: [{ id: '/docs/one.txt', title: 'one.txt', content: 'one' }],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const originalManifest = await readFile(join(storeDir, 'manifest.json'), 'utf-8');
    const originalCache = await readFile(oldCachePath, 'utf-8');
    const originalCacheMeta = await readFile(oldCacheMetaPath, 'utf-8');
    let queryCount = 0;
    const emptyCacheController: PromptCacheController = {
      prepare: async () => ({
        ref: '',
        includes: { instructions: false, dataElementCount: 0, tools: false },
      }),
      release: () => {},
      close: async () => {},
    };
    createRuntimeMock.mockImplementationOnce(async () => ({
      driver: new TestDriver({
        responses: () => {
          queryCount += 1;
          return 'query should not run';
        },
      }),
      cacheController: emptyCacheController,
      model: 'test-model',
      close: runtimeClose,
    }));

    await expect(appendToExtractStore({
      storeDir,
      storename: 'meeting',
      incomingMaterials: [{ id: '/docs/two.txt', title: 'two.txt', content: 'two' }],
    })).rejects.toThrow(/Required cache preparation failed.*empty handle/);

    expect(queryCount).toBe(0);
    expect(await readFile(join(storeDir, 'manifest.json'), 'utf-8')).toBe(originalManifest);
    expect(await readFile(oldCachePath, 'utf-8')).toBe(originalCache);
    expect(await readFile(oldCacheMetaPath, 'utf-8')).toBe(originalCacheMeta);
    expect((await readFile(join(storeDir, 'manifest.json'), 'utf-8'))).not.toContain('two.txt');
  });

  it('commits an incremental cache/index and opens a runtime on the new store', async () => {
    const storeDir = join(tempDir, 'meeting');
    const baseCacheName = 'base-cache.safetensors.zip';
    const baseCachePath = join(storeDir, baseCacheName);
    await mkdir(storeDir, { recursive: true });
    await writeFile(baseCachePath, 'base-cache', 'utf-8');
    await writeFile(`${baseCachePath}.meta.json`, JSON.stringify({ token_count: 10 }), 'utf-8');
    await writeFile(
      join(storeDir, 'cache-index.json'),
      JSON.stringify({ version: 1, entries: [{ key: 'base' }] }),
      'utf-8',
    );
    await writeManifest(storeDir, {
      version: 1,
      storename: 'meeting',
      model: 'test-model',
      materials: [{ id: '/docs/one.txt', title: 'one.txt', content: 'one' }],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    let prepareCacheDir: string | undefined;
    const prepare = vi.fn(async (params) => {
      const cacheDir = prepareCacheDir!;
      expect(await readFile(join(cacheDir, baseCacheName), 'utf-8')).toBe('base-cache');
      const newCachePath = join(cacheDir, 'incremental-cache.safetensors.zip');
      await writeFile(newCachePath, 'incremental-cache', 'utf-8');
      await writeFile(`${newCachePath}.meta.json`, JSON.stringify({ token_count: 20 }), 'utf-8');
      await writeFile(
        join(cacheDir, 'cache-index.json'),
        JSON.stringify({ version: 1, entries: [{ key: 'base' }, { key: 'incremental' }] }),
        'utf-8',
      );
      return {
        ref: newCachePath,
        includes: {
          instructions: (params.instructions?.length ?? 0) > 0,
          dataElementCount: params.data?.length ?? 0,
          tools: false,
        },
        supersedes: join(cacheDir, baseCacheName),
      };
    });
    const incrementalController: PromptCacheController = {
      prepare,
      release: vi.fn(),
      close: vi.fn(async () => {}),
    };
    const firstRuntimeClose = vi.fn().mockResolvedValue(undefined);
    createRuntimeMock.mockImplementationOnce(async ({ cacheDir }: { cacheDir: string }) => {
      prepareCacheDir = cacheDir;
      return {
        driver: new TestDriver({ responses: ['prepared'] }),
        cacheController: incrementalController,
        model: 'test-model',
        close: firstRuntimeClose,
      };
    });

    const result = await appendToExtractStore({
      storeDir,
      storename: 'meeting',
      incomingMaterials: [{ id: '/docs/two.txt', title: 'two.txt', content: 'two' }],
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(prepareCacheDir).toContain('.meeting.add-');
    expect(result.manifest.materials).toHaveLength(2);
    expect(await readFile(join(storeDir, 'incremental-cache.safetensors.zip'), 'utf-8'))
      .toBe('incremental-cache');
    expect(await readFile(join(storeDir, baseCacheName), 'utf-8')).toBe('base-cache');
    expect(await readFile(join(storeDir, 'cache-index.json'), 'utf-8'))
      .toContain('incremental');
    expect(firstRuntimeClose).toHaveBeenCalledOnce();

    const postCommitController: PromptCacheController = {
      prepare: vi.fn(async () => {
        await expect(readFile(join(storeDir, 'incremental-cache.safetensors.zip'), 'utf-8'))
          .resolves.toBe('incremental-cache');
        return {
          ref: join(storeDir, 'incremental-cache.safetensors.zip'),
          includes: { instructions: true, dataElementCount: 2, tools: false },
        };
      }),
      release: vi.fn(),
      close: vi.fn(async () => {}),
    };
    const postCommitRuntimeClose = vi.fn().mockResolvedValue(undefined);
    createRuntimeMock.mockImplementationOnce(async ({ cacheDir }: { cacheDir: string }) => ({
      driver: new TestDriver({ responses: ['available after commit'] }),
      cacheController: postCommitController,
      model: 'test-model',
      close: postCommitRuntimeClose,
      requestedCacheDir: cacheDir,
    }));
    const postCommitRuntime = await createRuntimeMock({
      model: 'test-model',
      cacheDir: storeDir,
    });
    expect(postCommitRuntime.requestedCacheDir).toBe(storeDir);
    const session = createExtractSession({
      driver: postCommitRuntime.driver,
      cacheController: postCommitRuntime.cacheController,
      model: postCommitRuntime.model,
      corpus: { materials: result.manifest.materials },
    });
    await expect(session.extract({ cue: 'Use the committed cache' })).resolves.toMatchObject({
      text: 'available after commit',
    });
    await session.close({ releaseCache: false });
    await postCommitRuntime.close();
    expect(postCommitRuntimeClose).toHaveBeenCalledOnce();
  });
});
