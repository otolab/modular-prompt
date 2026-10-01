import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  inspectStoreKvCache,
  isKvCacheFile,
  resolveStoreDir,
  validateStorename,
} from './store.js';

describe('store paths', () => {
  it('resolves a store below the container', () => {
    expect(resolveStoreDir('/tmp/extract-cache', 'meeting'))
      .toBe('/tmp/extract-cache/meeting');
    expect(resolveStoreDir('/tmp/extract-cache', 'project_v2-1'))
      .toBe('/tmp/extract-cache/project_v2-1');
  });

  it.each(['', 'bad/name', '../outside', '-leading', '_leading', 'has space'])(
    'rejects path-unsafe storename %j',
    (storename) => {
      expect(() => validateStorename(storename)).toThrow(/Invalid storename/);
    },
  );

  it.each(['create', 'add', 'extract', 'list', 'clean'])('rejects reserved storename %s', (storename) => {
    expect(() => validateStorename(storename)).toThrow(/reserved/);
  });

  it('recognizes persisted MLX and PyTorch cache files', () => {
    expect(isKvCacheFile('cache.safetensors.zip')).toBe(true);
    expect(isKvCacheFile('cache.safetensors.zip.meta.json')).toBe(false);
    expect(isKvCacheFile('cache.pytorch-cache')).toBe(true);
    expect(isKvCacheFile('cache.pytorch-cache.meta.json')).toBe(false);
    expect(isKvCacheFile('cache.vlm.safetensors')).toBe(true);
    expect(isKvCacheFile('cache.vlm-vision.safetensors')).toBe(true);
  });

  it('marks an index-only store with a missing reference for rebuild', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'extract-store-status-'));
    try {
      await mkdir(join(tempDir, 'meeting'), { recursive: true });
      await writeFile(
        join(tempDir, 'meeting', 'cache-index.json'),
        JSON.stringify({ version: 1, entries: [{ key: 'missing-cache', backend: 'lm' }] }),
        'utf-8',
      );

      await expect(inspectStoreKvCache(join(tempDir, 'meeting'))).resolves.toMatchObject({
        hasKvCache: false,
        needsRebuild: true,
        hasIncrementalBase: false,
        issue: 'index-entry-missing',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
