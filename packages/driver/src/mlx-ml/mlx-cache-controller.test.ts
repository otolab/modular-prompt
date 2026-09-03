import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MlxCacheController } from './mlx-cache-controller.js';

vi.mock('node:fs', () => ({
  rmSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
}));

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
}));

const { mockRelease } = vi.hoisted(() => {
  const mockRelease = vi.fn().mockResolvedValue(undefined);
  return { mockRelease };
});
vi.mock('proper-lockfile', () => ({
  lock: vi.fn().mockResolvedValue(mockRelease),
  unlock: vi.fn().mockResolvedValue(undefined),
}));

import { unlink, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { lock } from 'proper-lockfile';

/** Sequential token IDs [0, 1, 2, ...] for consistent mock data */
const MOCK_TOKEN_COUNT = 5000;
const MOCK_TOKENS = Array.from({ length: MOCK_TOKEN_COUNT }, (_, i) => i);

/** Compute SHA256 hash of token prefix [0, 1, ..., length-1] matching computeTokenPrefixHash */
function testPrefixHash(length: number): string {
  const buffer = Buffer.alloc(length * 4);
  for (let i = 0; i < length; i++) buffer.writeInt32LE(i, i * 4);
  return createHash('sha256').update(buffer).digest('hex');
}

function createMockProcess() {
  return {
    cachePrefill: vi.fn().mockResolvedValue({ cache_path: '/tmp/mlx-prompt-cache-abc/test.safetensors.zip' }),
    tokenize: vi.fn().mockResolvedValue({
      token_ids: MOCK_TOKENS,
      token_count: MOCK_TOKEN_COUNT,
      error: null,
    }),
  };
}

describe('MlxCacheController', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;
  let controller: MlxCacheController;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('');
    mockProcess = createMockProcess();
    controller = new MlxCacheController();
    await controller.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});
  });

  afterEach(async () => {
    await controller.close();
  });

  describe('prepare', () => {
    it('should create cache with instructions', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'Be helpful' }],
      });

      expect(handle.ref).toMatch(/\.safetensors\.zip$/);
      expect(handle.includes.instructions).toBe(true);
      expect(handle.includes.dataElementCount).toBe(0);
      expect(handle.includes.tools).toBe(false);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      expect(mkdir).toHaveBeenCalledTimes(1);
    });

    it('should create cache with instructions and data', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'Be helpful' }],
        data: [{ type: 'material', id: 'm1', title: 'Doc', content: 'reference text' }],
      });

      expect(handle.includes.instructions).toBe(true);
      expect(handle.includes.dataElementCount).toBe(1);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
    });

    it('should reuse cache for identical params', async () => {
      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'Be helpful' }],
      };

      const handle1 = await controller.prepare(params);
      const handle2 = await controller.prepare(params);

      expect(handle1.ref).toBe(handle2.ref);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
    });

    it('should create separate caches for different params', async () => {
      const handle1 = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt A' }],
      });
      const handle2 = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt B' }],
      });

      expect(handle1.ref).not.toBe(handle2.ref);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(2);
    });

    it('should throw on empty instructions and data', async () => {
      await expect(controller.prepare({
        model: 'test-model',
      })).rejects.toThrow('Cannot prepare cache with no cacheable content');
      expect(mockProcess.cachePrefill).not.toHaveBeenCalled();
    });

    it('should return empty handle on read-only cache miss', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'Be helpful' }],
        readOnly: true,
      });

      expect(handle.ref).toBe('');
      expect(mockProcess.cachePrefill).not.toHaveBeenCalled();
      expect(mockProcess.tokenize).toHaveBeenCalled();
    });

    it('should return cached handle on read-only memory hit', async () => {
      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'Be helpful' }],
      };

      // First call creates the cache
      const handle1 = await controller.prepare(params);
      expect(handle1.ref).toMatch(/\.safetensors\.zip$/);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);

      // Second call with readOnly returns the cached handle
      const handle2 = await controller.prepare({ ...params, readOnly: true });
      expect(handle2.ref).toBe(handle1.ref);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
    });

    it('should return disk-cached handle on read-only disk hit', async () => {
      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'Be helpful' }],
      };

      // First call creates the cache on disk
      const handle1 = await controller.prepare(params);
      expect(handle1.ref).toMatch(/\.safetensors\.zip$/);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);

      // Clear memory cache to force disk lookup
      (controller as unknown as { cacheByHash: Map<string, unknown> }).cacheByHash.clear();

      // Simulate disk files exist for the cache path
      const cachePath = handle1.ref;
      vi.mocked(existsSync).mockImplementation((p: string | URL) => {
        const s = typeof p === 'string' ? p : p.toString();
        return s === cachePath || s === cachePath + '.meta.json';
      });
      vi.mocked(readFileSync).mockImplementation((p: string | URL | number) => {
        const s = typeof p === 'string' ? p : String(p);
        if (s === cachePath + '.meta.json') {
          return JSON.stringify({ token_count: 100 });
        }
        return '';
      });

      // read-only should find the disk cache and return it
      const handle2 = await controller.prepare({ ...params, readOnly: true });
      expect(handle2.ref).toBe(handle1.ref);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
    });

    it('should accept tools and pass them to cachePrefill', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'prompt' }],
        tools: [{ name: 'get_weather', description: 'Get weather', parameters: {} }],
      });
      expect(handle.ref).toBeTruthy();
      expect(handle.includes.tools).toBe(true);
      const call = mockProcess.cachePrefill.mock.calls[0];
      expect(call[6]).toBeDefined();
      expect(call[6][0].function.name).toBe('get_weather');
    });

    it('should coalesce concurrent calls with identical params', async () => {
      let resolvePrefill: (val: { cache_path: string }) => void;
      mockProcess.cachePrefill.mockReturnValueOnce(
        new Promise(resolve => { resolvePrefill = resolve; })
      );

      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };

      const p1 = controller.prepare(params);
      const p2 = controller.prepare(params);

      resolvePrefill!({ cache_path: '/tmp/mlx-prompt-cache-abc/coalesced.safetensors.zip' });

      const [h1, h2] = await Promise.all([p1, p2]);
      expect(h1.ref).toBe(h2.ref);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
    });

    it('should pass file path and formatted messages to process.cachePrefill', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
        data: [{ type: 'material', id: 'm1', title: 'Doc', content: 'content' }],
      });

      const [cachePath, messages] = mockProcess.cachePrefill.mock.calls[0];
      expect(cachePath).toMatch(/\.safetensors\.zip$/);
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should throw when not bound to a process', async () => {
      const unboundController = new MlxCacheController();
      await expect(unboundController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      })).rejects.toThrow('MlxCacheController is not bound to a process');
    });

    it('should produce different cache keys for different formatterOptions', async () => {
      const controllerA = new MlxCacheController();
      await controllerA.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, { specialTokens: { bosToken: { text: '<s>', id: 1 } } });

      const controllerB = new MlxCacheController();
      await controllerB.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, { specialTokens: { bosToken: { text: '<bos>', id: 1 } } });

      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };

      const handleA = await controllerA.prepare(params);
      const handleB = await controllerB.prepare(params);

      expect(handleA.ref).not.toBe(handleB.ref);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(2);

      await controllerA.close();
      await controllerB.close();
    });
  });

  describe('release', () => {
    it('should not delete the cache file immediately', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'prompt' }],
      });

      controller.release(handle.ref);
      // release はファイルを削除しない
      expect(unlink).not.toHaveBeenCalledWith(handle.ref);
    });

    it('should remove from memory cache so prepare creates new prefill', async () => {
      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };

      const handle1 = await controller.prepare(params);
      controller.release(handle1.ref);

      // release 後に同じ params で prepare すると新規 prefill が走る
      await controller.prepare(params);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(2);
    });

    it('should not throw for unknown ref', () => {
      // 存在しない ref を release しても問題ない
      expect(() => controller.release('/nonexistent/path.safetensors.zip')).not.toThrow();
    });
  });

  describe('close', () => {
    it('should remove cache directory recursively', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'a' }],
      });
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'b' }],
      });

      await controller.close();
      expect(rm).toHaveBeenCalledTimes(1);
      expect(rm).toHaveBeenCalledWith(
        expect.stringMatching(/mlx-prompt-cache-/),
        { recursive: true, force: true }
      );
    });

    it('should wait for inflight requests before closing', async () => {
      let resolvePrefill: (val: { cache_path: string }) => void;
      mockProcess.cachePrefill.mockReturnValueOnce(
        new Promise(resolve => { resolvePrefill = resolve; })
      );

      const preparePromise = controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'inflight' }],
      });

      const closePromise = controller.close();

      resolvePrefill!({ cache_path: '/tmp/mlx-prompt-cache-abc/done.safetensors.zip' });
      await preparePromise;
      await closePromise;

      expect(rm).toHaveBeenCalledTimes(1);
    });

    it('should suppress errors during directory removal on close', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });
      vi.mocked(rm).mockRejectedValueOnce(new Error('rm failed'));

      await expect(controller.close()).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should return empty handle on prefill failure', async () => {
      mockProcess.cachePrefill.mockRejectedValueOnce(new Error('prefill failed'));

      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });
      expect(handle.ref).toBe('');
      expect(handle.includes.instructions).toBe(false);
    });
  });

  describe('bind', () => {
    it('should throw when bind is called twice', async () => {
      const ctrl = new MlxCacheController();
      await ctrl.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});
      await expect(ctrl.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {}))
        .rejects.toThrow('MlxCacheController is already bound to a process');
    });
  });

  describe('external cacheDir', () => {
    let externalController: MlxCacheController;

    beforeEach(async () => {
      externalController = new MlxCacheController({ cacheDir: '/custom/cache/dir' });
      await externalController.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});
    });

    afterEach(async () => {
      await externalController.close();
    });

    it('should use specified cacheDir for cache paths', async () => {
      const handle = await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });

      expect(handle.ref).toMatch(/^\/custom\/cache\/dir\//);
      expect(handle.ref).toMatch(/\.safetensors\.zip$/);
    });

    it('should not remove directory on close', async () => {
      await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });

      await externalController.close();
      expect(rm).not.toHaveBeenCalled();
    });

    it('should skip prefill when cache file already exists', async () => {
      // Both .safetensors.zip and .meta.json need to exist with valid token_count
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)  // .safetensors.zip check
        .mockReturnValueOnce(true); // .meta.json check
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify({ token_count: 100, prefix_offsets: [100], prefix_hashes: [testPrefixHash(100)] }));

      const handle = await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });

      expect(handle.ref).toMatch(/\.safetensors\.zip$/);
      expect(handle.includes.instructions).toBe(true);
      expect(mockProcess.cachePrefill).not.toHaveBeenCalled();
    });

    it('should regenerate cache when .meta.json is missing (legacy cache)', async () => {
      // .safetensors.zip exists but .meta.json does not
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)   // .safetensors.zip check
        .mockReturnValueOnce(false); // .meta.json check

      const handle = await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });

      expect(handle.ref).toMatch(/\.safetensors\.zip$/);
      expect(handle.includes.instructions).toBe(true);
      // Should regenerate the cache with metadata
      expect(mockProcess.cachePrefill).toHaveBeenCalled();
    });
  });

  describe('incremental prefill', () => {
    it('should pass lastHandle as baseCachePath on second prepare', async () => {
      // 1回目: baseCachePathなし
      const handle1 = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const [, , basePath1] = mockProcess.cachePrefill.mock.calls[0];
      expect(basePath1).toBeUndefined();

      // lastHandleのファイルが存在する状態にする
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path === handle1.ref || path === handle1.ref + '.meta.json';
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ token_count: 100, prefix_offsets: [100], prefix_hashes: [testPrefixHash(100)] }));

      // 2回目: 異なるparams → lastHandleがbaseCachePathとして渡される
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'system prompt' }],
        data: [{ type: 'text' as const, content: 'message 1' }],
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(2);
      const [, , basePath2] = mockProcess.cachePrefill.mock.calls[1];
      expect(basePath2).toBe(handle1.ref);
    });

    it('should set supersedes to base cache ref on incremental prefill', async () => {
      const handle1 = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
      });

      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path === handle1.ref || path === handle1.ref + '.meta.json';
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        token_count: 100,
        prefix_offsets: [100],
        prefix_hashes: [testPrefixHash(100)],
      }));

      const handle2 = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'system prompt' }],
        data: [{ type: 'text' as const, content: 'message 1' }],
      });

      expect(handle2.supersedes).toBe(handle1.ref);
    });

    it('should leave supersedes undefined on fresh prefill', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
      });

      expect(handle.supersedes).toBeUndefined();
    });

    it('should fall back to index when lastHandle file is missing', async () => {
      const externalController = new MlxCacheController({ cacheDir: '/cache' });
      await externalController.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      // 1回目
      await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
      });

      // existsSyncを設定: lastHandleのファイルは存在しない（削除された想定）
      // ただし新しいキャッシュパスも存在しない
      vi.mocked(existsSync).mockReturnValue(false);

      // 2回目: lastHandleのファイルが無い → baseCachePathはundefined
      await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'system prompt' }],
        data: [{ type: 'text' as const, content: 'message 1' }],
      });

      const [, , basePath2] = mockProcess.cachePrefill.mock.calls[1];
      expect(basePath2).toBeUndefined();

      await externalController.close();
    });

    it('should discover base cache from index on fresh controller', async () => {
      // インデックスにエントリがある状態でコントローラを作成
      const instructions = [{ type: 'text' as const, content: 'system prompt' }];
      const instructionHash = 'i:' + createHash('sha256')
        .update(JSON.stringify(instructions[0]))
        .digest('hex');

      const existingKey = createHash('sha256')
        .update(JSON.stringify({ model: 'test-model', instructions }))
        .digest('hex');

      const indexData = {
        version: 1,
        entries: [{
          key: existingKey,
          model: 'test-model',
          formatterOptionsHash: '',
          elementHashes: [instructionHash],
          createdAt: new Date().toISOString(),
        }],
      };

      // readFileSyncでmeta.jsonを返す
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('.meta.json')) return JSON.stringify({ token_count: 100, prefix_offsets: [100], prefix_hashes: [testPrefixHash(100)] });
        return JSON.stringify(indexData);
      });
      // readFile（async）でインデックスを返す（loadIndexが使用）
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      // existsSyncの設定: indexPathとキャッシュファイルは存在する
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('cache-index.json')) return true;
        if (pathStr.endsWith(`${existingKey}.safetensors.zip`)) return true;
        if (pathStr.endsWith(`${existingKey}.safetensors.zip.meta.json`)) return true;
        return false;
      });

      const freshController = new MlxCacheController({ cacheDir: '/cache' });
      await freshController.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      // 新しいprepare: instructionsは同じ + data追加 → インデックスからbase cache発見
      await freshController.prepare({
        model: 'test-model',
        instructions,
        data: [{ type: 'text' as const, content: 'message 1' }],
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const [, , basePath] = mockProcess.cachePrefill.mock.calls[0];
      expect(basePath).toMatch(new RegExp(`${existingKey}\\.safetensors\\.zip$`));

      await freshController.close();
    });

    it('should save index to file after cache creation for external dir', async () => {
      const externalController = new MlxCacheController({ cacheDir: '/cache' });
      await externalController.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });

      expect(writeFile).toHaveBeenCalledWith(
        '/cache/cache-index.json',
        expect.any(String),
      );

      // 保存されたJSONを検証
      const savedJson = JSON.parse(vi.mocked(writeFile).mock.calls[0][1] as string);
      expect(savedJson.version).toBe(1);
      expect(savedJson.entries).toHaveLength(1);
      expect(savedJson.entries[0].model).toBe('test-model');
      expect(savedJson.entries[0].elementHashes).toHaveLength(1);

      await externalController.close();
    });

    it('should not save index for managed temp dir', async () => {
      // デフォルトコントローラ（managedDir=true）
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should pass prefixOffsets and prefixHashes to cachePrefill', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [
          { type: 'text', content: 'inst A' },
          { type: 'text', content: 'inst B' },
        ],
        data: [
          { type: 'text', content: 'data 0' },
        ],
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const args = mockProcess.cachePrefill.mock.calls[0];
      const prefixOffsets = args[4] as number[];
      const prefixHashes = args[5] as string[];
      // 2 inst + 1 data → 1 section boundary (inst→data) + 1 full sequence = 2 entries
      expect(prefixOffsets).toHaveLength(2);
      expect(prefixHashes).toHaveLength(2);
      // Full sequence hash is the last entry
      expect(prefixOffsets[prefixOffsets.length - 1]).toBe(MOCK_TOKEN_COUNT);
      expect(prefixHashes[prefixHashes.length - 1]).toBe(testPrefixHash(MOCK_TOKEN_COUNT));
    });

    it('should include immutable boundary hash in prefix info', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [
          { type: 'text', content: 'inst A' },
        ],
        data: [
          { type: 'message', role: 'user' as const, content: 'msg 1', cacheHint: 'immutable' as const },
          { type: 'message', role: 'assistant' as const, content: 'msg 2', cacheHint: 'immutable' as const },
          { type: 'message', role: 'user' as const, content: 'msg 3' },
        ],
      });

      const args = mockProcess.cachePrefill.mock.calls[0];
      const prefixOffsets = args[4] as number[];
      const prefixHashes = args[5] as string[];
      // 1 inst + 3 data → section boundary (idx 0) + last immutable (idx 2) + full sequence = 3 entries
      // But section boundary idx=0 and last immutable idx=2 are different, so 3 entries
      expect(prefixOffsets).toHaveLength(3);
      expect(prefixHashes).toHaveLength(3);
      expect(prefixOffsets[prefixOffsets.length - 1]).toBe(MOCK_TOKEN_COUNT);
    });

    it('should deduplicate when section boundary equals immutable boundary', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [
          { type: 'text', content: 'inst A', cacheHint: 'immutable' as const },
        ],
        data: [
          { type: 'message', role: 'user' as const, content: 'msg 1' },
        ],
      });

      const args = mockProcess.cachePrefill.mock.calls[0];
      const prefixOffsets = args[4] as number[];
      const prefixHashes = args[5] as string[];
      // data[0]はcacheHintなし → immutableではないのでimmutable境界は追加されない
      // Result: section boundary + full sequence = 2 entries
      expect(prefixOffsets).toHaveLength(2);
      expect(prefixHashes).toHaveLength(2);
    });

    it('should include immutable boundary when all data elements are immutable', async () => {
      // 全dataがimmutableの場合、最後のdata要素がimmutable境界になる
      await controller.prepare({
        model: 'test-model',
        instructions: [
          { type: 'text', content: 'inst A' },
        ],
        data: [
          { type: 'message', role: 'user' as const, content: 'msg 1', cacheHint: 'immutable' as const },
          { type: 'message', role: 'assistant' as const, content: 'msg 2', cacheHint: 'immutable' as const },
        ],
      });

      const args = mockProcess.cachePrefill.mock.calls[0];
      const prefixOffsets = args[4] as number[];
      const prefixHashes = args[5] as string[];
      // section boundary (instructions.length - 1) + immutable境界 (最後のimmutable data) + full sequence = 3 entries
      expect(prefixOffsets).toHaveLength(3);
      expect(prefixHashes).toHaveLength(3);
    });

    it('should stop immutable boundary at first non-immutable data element', async () => {
      // data: [static, immutable, contextual, static, immutable]
      // 前方走査で idx=0 (static≠immutable) → break → lastImmutableIdx=-1
      // immutable境界は追加されない → section boundary + full = 2 entries
      await controller.prepare({
        model: 'test-model',
        instructions: [
          { type: 'text', content: 'inst A' },
        ],
        data: [
          { type: 'message', role: 'user' as const, content: 'msg 1', cacheHint: 'static' as const },
          { type: 'message', role: 'user' as const, content: 'msg 2', cacheHint: 'immutable' as const },
          { type: 'message', role: 'user' as const, content: 'msg 3', cacheHint: 'contextual' as const },
          { type: 'message', role: 'user' as const, content: 'msg 4', cacheHint: 'static' as const },
          { type: 'message', role: 'user' as const, content: 'msg 5', cacheHint: 'immutable' as const },
        ],
      });

      const args = mockProcess.cachePrefill.mock.calls[0];
      const prefixOffsets = args[4] as number[];
      const prefixHashes = args[5] as string[];
      // static is not immutable → immutable continuity never starts → no immutable boundary
      expect(prefixOffsets).toHaveLength(2);
      expect(prefixHashes).toHaveLength(2);
    });

    it('should include full sequence hash even for single element', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'inst A' }],
      });

      const args = mockProcess.cachePrefill.mock.calls[0];
      const prefixOffsets = args[4] as number[];
      const prefixHashes = args[5] as string[];
      // 1 element → 0 intermediate + 1 full sequence = 1 entry
      expect(prefixOffsets).toHaveLength(1);
      expect(prefixHashes).toHaveLength(1);
      expect(prefixOffsets[0]).toBe(MOCK_TOKEN_COUNT);
      expect(prefixHashes[0]).toBe(testPrefixHash(MOCK_TOKEN_COUNT));
    });

    it('should reuse superset base cache without creating new file', async () => {
      const crypto = { createHash };
      const instructions = [
        { type: 'text' as const, content: 'inst A' },
        { type: 'text' as const, content: 'inst B' },
      ];
      const data = [
        { type: 'text' as const, content: 'data 0' },
        { type: 'text' as const, content: 'data 1' },
      ];

      // Build hash for the superset entry (instructions + all data)
      const supersetKey = crypto.createHash('sha256')
        .update(JSON.stringify({ model: 'test-model', instructions, data }))
        .digest('hex');
      const instHash0 = 'i:' + crypto.createHash('sha256').update(JSON.stringify(instructions[0])).digest('hex');
      const instHash1 = 'i:' + crypto.createHash('sha256').update(JSON.stringify(instructions[1])).digest('hex');
      const dataHash0 = 'd:' + crypto.createHash('sha256').update(JSON.stringify(data[0])).digest('hex');
      const dataHash1 = 'd:' + crypto.createHash('sha256').update(JSON.stringify(data[1])).digest('hex');

      const indexData = {
        version: 1,
        entries: [{
          key: supersetKey,
          model: 'test-model',
          formatterOptionsHash: '',
          elementHashes: [instHash0, instHash1, dataHash0, dataHash1],
          createdAt: new Date().toISOString(),
        }],
      };

      const supersetPath = `/cache/${supersetKey}.safetensors.zip`;
      const metaData = {
        token_count: 3000,
        prefix_offsets: [120, 245, 380, 3000],
        prefix_hashes: [
          testPrefixHash(120), testPrefixHash(245),
          'diverged_at_380', 'diverged_at_3000',
        ],
      };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        if (p.endsWith('.meta.json')) return JSON.stringify(metaData);
        return '';
      });
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return true;
        if (p === supersetPath) return true;
        return false;
      });

      const ctrl = new MlxCacheController({ cacheDir: '/cache' });
      await ctrl.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      // Request only first 2 elements (inst A, inst B) — subset of superset
      const handle = await ctrl.prepare({
        model: 'test-model',
        instructions,
      });

      // Should NOT call cachePrefill — superset reuse
      expect(mockProcess.cachePrefill).not.toHaveBeenCalled();
      // Handle should reference the superset file with trim
      expect(handle.ref).toBe(supersetPath);
      expect(handle.trimTokens).toBe(245); // offsets[1] for 2 elements

      await ctrl.close();
    });

    it('should use partial match with trim when prefix hashes match', async () => {
      const crypto = { createHash };
      const inst = [{ type: 'text' as const, content: 'inst A' }];
      const dataOld = [
        { type: 'text' as const, content: 'data 0' },
        { type: 'text' as const, content: 'data 1 old' },
      ];
      const dataNew = [
        { type: 'text' as const, content: 'data 0' },
        { type: 'text' as const, content: 'data 1 new' },
      ];

      const oldKey = crypto.createHash('sha256')
        .update(JSON.stringify({ model: 'test-model', instructions: inst, data: dataOld }))
        .digest('hex');
      const instHash = 'i:' + crypto.createHash('sha256').update(JSON.stringify(inst[0])).digest('hex');
      const dataHash0 = 'd:' + crypto.createHash('sha256').update(JSON.stringify(dataOld[0])).digest('hex');
      const dataHash1Old = 'd:' + crypto.createHash('sha256').update(JSON.stringify(dataOld[1])).digest('hex');

      const indexData = {
        version: 1,
        entries: [{
          key: oldKey,
          model: 'test-model',
          formatterOptionsHash: '',
          elementHashes: [instHash, dataHash0, dataHash1Old],
          createdAt: new Date().toISOString(),
        }],
      };

      const oldPath = `/cache/${oldKey}.safetensors.zip`;
      const metaData = {
        token_count: 500,
        prefix_offsets: [100, 300, 500],
        prefix_hashes: [testPrefixHash(100), testPrefixHash(300), 'diverged_at_500'],
      };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        if (p.endsWith('.meta.json')) return JSON.stringify(metaData);
        return '';
      });
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return true;
        if (p === oldPath) return true;
        return false;
      });

      const ctrl = new MlxCacheController({ cacheDir: '/cache' });
      await ctrl.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      // Request with different data[1] — first 2 elements match (inst + data 0)
      await ctrl.prepare({
        model: 'test-model',
        instructions: inst,
        data: dataNew,
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const [, , basePath, trimTokens] = mockProcess.cachePrefill.mock.calls[0];
      expect(basePath).toBe(oldPath);
      expect(trimTokens).toBe(300); // offsets[1] — trim to 2nd element boundary

      await ctrl.close();
    });

    it('should skip partial match when no prefix meta', async () => {
      const crypto = { createHash };
      const inst = [{ type: 'text' as const, content: 'inst A' }];
      const dataOld = [{ type: 'text' as const, content: 'data old' }];
      const dataNew = [{ type: 'text' as const, content: 'data new' }];

      const oldKey = crypto.createHash('sha256')
        .update(JSON.stringify({ model: 'test-model', instructions: inst, data: dataOld }))
        .digest('hex');
      const instHash = 'i:' + crypto.createHash('sha256').update(JSON.stringify(inst[0])).digest('hex');
      const dataHashOld = 'd:' + crypto.createHash('sha256').update(JSON.stringify(dataOld[0])).digest('hex');

      const indexData = {
        version: 1,
        entries: [{
          key: oldKey,
          model: 'test-model',
          formatterOptionsHash: '',
          elementHashes: [instHash, dataHashOld],
          createdAt: new Date().toISOString(),
        }],
      };

      const oldPath = `/cache/${oldKey}.safetensors.zip`;
      // meta WITHOUT element_offsets
      const metaData = { token_count: 300 };

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        if (p.endsWith('.meta.json')) return JSON.stringify(metaData);
        return '';
      });
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return true;
        if (p === oldPath) return true;
        return false;
      });

      const ctrl = new MlxCacheController({ cacheDir: '/cache' });
      await ctrl.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      // inst matches but data differs — partial match, no offsets → cannot trim
      await ctrl.prepare({
        model: 'test-model',
        instructions: inst,
        data: dataNew,
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const [, , basePath, trimTokens] = mockProcess.cachePrefill.mock.calls[0];
      // Should NOT use the old cache as base (no offsets for trim)
      expect(basePath).toBeUndefined();
      expect(trimTokens).toBeUndefined();

      await ctrl.close();
    });

    it('should not use base cache with different tools', async () => {
      const crypto = { createHash };
      const inst = [{ type: 'text' as const, content: 'inst A' }];

      const tools = [{ name: 'get_weather' }];
      const toolsHash = crypto.createHash('sha256')
        .update(JSON.stringify(tools))
        .digest('hex');

      const toolKey = crypto.createHash('sha256')
        .update(JSON.stringify({
          model: 'test-model',
          instructions: inst,
          tools: tools,
        }))
        .digest('hex');
      const instHash = 'i:' + crypto.createHash('sha256').update(JSON.stringify(inst[0])).digest('hex');

      const indexData = {
        version: 1,
        entries: [{
          key: toolKey,
          model: 'test-model',
          formatterOptionsHash: '',
          elementHashes: [instHash],
          toolsHash: toolsHash,
          createdAt: new Date().toISOString(),
        }],
      };

      const toolPath = `/cache/${toolKey}.safetensors.zip`;

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return true;
        if (p === toolPath) return true;
        return false;
      });

      const ctrl = new MlxCacheController({ cacheDir: '/cache' });
      await ctrl.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      await ctrl.prepare({
        model: 'test-model',
        instructions: inst,
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const [, , basePath] = mockProcess.cachePrefill.mock.calls[0];
      expect(basePath).toBeUndefined();

      await ctrl.close();
    });

    it('should not use base cache with different reasoningEffort', async () => {
      const crypto = { createHash };
      const inst = [{ type: 'text' as const, content: 'inst A' }];

      const highKey = crypto.createHash('sha256')
        .update(JSON.stringify({
          model: 'test-model',
          instructions: inst,
          reasoningEffort: 'high',
        }))
        .digest('hex');
      const instHash = 'i:' + crypto.createHash('sha256').update(JSON.stringify(inst[0])).digest('hex');

      const indexData = {
        version: 1,
        entries: [{
          key: highKey,
          model: 'test-model',
          formatterOptionsHash: '',
          elementHashes: [instHash],
          reasoningEffort: 'high',
          createdAt: new Date().toISOString(),
        }],
      };

      const highPath = `/cache/${highKey}.safetensors.zip`;

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return JSON.stringify(indexData);
        return '';
      });
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.endsWith('cache-index.json')) return true;
        if (p === highPath) return true;
        return false;
      });

      const ctrl = new MlxCacheController({ cacheDir: '/cache' });
      await ctrl.bind(mockProcess as unknown as import('./process/index.js').MlxProcess, {});

      await ctrl.prepare({
        model: 'test-model',
        instructions: inst,
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const [, , basePath] = mockProcess.cachePrefill.mock.calls[0];
      expect(basePath).toBeUndefined();

      await ctrl.close();
    });
  });

  describe('file locking', () => {
    // テスト用のコントローラ（managedDir=false、ロックが有効な状態）
    let lockedController: MlxCacheController;

    beforeEach(() => {
      lockedController = new MlxCacheController({ cacheDir: '/custom/cache/dir' });
    });

    afterEach(async () => {
      await lockedController.close();
    });

    describe('bind with async loadIndex', () => {
      it('should acquire lock when loading index (managedDir=false)', async () => {
        // indexファイルが存在するケース
        vi.mocked(existsSync).mockReturnValueOnce(true); // indexPath check
        vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({
          version: 1,
          entries: [],
        }));

        await lockedController.bind(mockProcess as any, {});

        expect(readFile).toHaveBeenCalledWith('/custom/cache/dir/cache-index.json', 'utf-8');
        // lockが呼ばれたことを確認
        expect(lock).toHaveBeenCalledWith(
          '/custom/cache/dir/cache-index.json',
          expect.objectContaining({ realpath: false })
        );
        // release関数が呼ばれたことを確認
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should not acquire lock when managedDir=true', async () => {
        const managedController = new MlxCacheController(); // managedDir=true
        await managedController.bind(mockProcess as any, {});

        expect(lock).not.toHaveBeenCalled();
        await managedController.close();
      });
    });

    describe('saveIndex with lock', () => {
      it('should acquire lock when saving index', async () => {
        await lockedController.bind(mockProcess as any, {});
        vi.mocked(lock).mockClear();
        vi.mocked(mockRelease).mockClear();

        await lockedController.prepare({
          model: 'test-model',
          instructions: [{ type: 'text', content: 'test' }],
        });

        // saveIndexがロック付きで呼ばれたことを確認
        expect(lock).toHaveBeenCalledWith(
          '/custom/cache/dir/cache-index.json',
          expect.objectContaining({ realpath: false })
        );
        expect(mockRelease).toHaveBeenCalled();
      });

      it('should not acquire lock when managedDir=true', async () => {
        // managedDirのcontrollerではsaveIndexがスキップされるのでlockも不要
        await controller.prepare({
          model: 'test-model',
          instructions: [{ type: 'text', content: 'test' }],
        });

        expect(lock).not.toHaveBeenCalled();
      });
    });

    describe('lock error handling', () => {
      it('should handle lock acquisition failure gracefully in loadIndex', async () => {
        vi.mocked(lock).mockRejectedValueOnce(new Error('ELOCKED'));

        // bind should not throw even if lock fails
        await expect(
          lockedController.bind(mockProcess as any, {})
        ).resolves.not.toThrow();
      });

      it('should handle lock acquisition failure gracefully in saveIndex', async () => {
        await lockedController.bind(mockProcess as any, {});
        vi.mocked(lock).mockClear();
        vi.mocked(lock).mockRejectedValue(new Error('ELOCKED'));

        // prepare should not throw even if saveIndex lock fails
        await expect(
          lockedController.prepare({
            model: 'test-model',
            instructions: [{ type: 'text', content: 'test' }],
          })
        ).resolves.toBeDefined();
      });
    });

    describe('close with lock', () => {
      it('should acquire lock when saving index on close (managedDir=false)', async () => {
        await lockedController.bind(mockProcess as any, {});
        vi.mocked(lock).mockReset();
        vi.mocked(lock).mockResolvedValue(mockRelease);
        vi.mocked(mockRelease).mockClear();

        await lockedController.close();

        expect(lock).toHaveBeenCalledWith(
          '/custom/cache/dir/cache-index.json',
          expect.objectContaining({ realpath: false })
        );
        expect(mockRelease).toHaveBeenCalled();
      });
    });
  });
});
