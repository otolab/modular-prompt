import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestDriver, type PromptCacheController } from '@modular-prompt/driver';
import { createMockCacheController } from './test-helpers.js';
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
});
