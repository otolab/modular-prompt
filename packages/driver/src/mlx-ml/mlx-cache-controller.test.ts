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
}));

import { unlink, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

function createMockProcess() {
  return {
    cachePrefill: vi.fn().mockResolvedValue({ cache_path: '/tmp/mlx-prompt-cache-abc/test.safetensors' }),
  };
}

describe('MlxCacheController', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;
  let controller: MlxCacheController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('');
    mockProcess = createMockProcess();
    controller = new MlxCacheController();
    controller.bind(mockProcess as any, {});
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

      expect(handle.ref).toMatch(/\.safetensors$/);
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

    it('should reject when tools are provided', async () => {
      await expect(controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'prompt' }],
        tools: [{ name: 'get_weather', description: 'Get weather', parameters: {} }],
      })).rejects.toThrow('MlxCacheController does not support tool-aware caching');
      expect(mockProcess.cachePrefill).not.toHaveBeenCalled();
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

      resolvePrefill!({ cache_path: '/tmp/mlx-prompt-cache-abc/coalesced.safetensors' });

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
      expect(cachePath).toMatch(/\.safetensors$/);
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
      controllerA.bind(mockProcess as any, { specialTokens: { bosToken: '<s>' } });

      const controllerB = new MlxCacheController();
      controllerB.bind(mockProcess as any, { specialTokens: { bosToken: '<bos>' } });

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

  describe('invalidate', () => {
    it('should delete the cache file', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'prompt' }],
      });

      await controller.invalidate(handle);
      expect(unlink).toHaveBeenCalledWith(handle.ref);
    });

    it('should allow re-creation after invalidation', async () => {
      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };

      const handle1 = await controller.prepare(params);
      await controller.invalidate(handle1);

      await controller.prepare(params);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(2);
    });

    it('should suppress errors when file does not exist', async () => {
      vi.mocked(unlink).mockRejectedValueOnce(new Error('ENOENT'));
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'prompt' }],
      });

      await expect(controller.invalidate(handle)).resolves.toBeUndefined();
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

      resolvePrefill!({ cache_path: '/tmp/mlx-prompt-cache-abc/done.safetensors' });
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
    it('should throw when bind is called twice', () => {
      const ctrl = new MlxCacheController();
      ctrl.bind(mockProcess as any, {});
      expect(() => ctrl.bind(mockProcess as any, {}))
        .toThrow('MlxCacheController is already bound to a process');
    });
  });

  describe('external cacheDir', () => {
    let externalController: MlxCacheController;

    beforeEach(() => {
      externalController = new MlxCacheController({ cacheDir: '/custom/cache/dir' });
      externalController.bind(mockProcess as any, {});
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
      expect(handle.ref).toMatch(/\.safetensors$/);
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
      vi.mocked(existsSync).mockReturnValueOnce(true);

      const handle = await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'test' }],
      });

      expect(handle.ref).toMatch(/\.safetensors$/);
      expect(handle.includes.instructions).toBe(true);
      expect(mockProcess.cachePrefill).not.toHaveBeenCalled();
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
        return path === handle1.ref;
      });

      // 2回目: 異なるparams → lastHandleがbaseCachePathとして渡される
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
        data: [{ type: 'text', content: 'message 1' }],
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(2);
      const [, , basePath2] = mockProcess.cachePrefill.mock.calls[1];
      expect(basePath2).toBe(handle1.ref);
    });

    it('should fall back to index when lastHandle file is missing', async () => {
      const externalController = new MlxCacheController({ cacheDir: '/cache' });
      externalController.bind(mockProcess as any, {});

      // 1回目
      const handle1 = await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
      });

      // existsSyncを設定: handle1のファイルは存在しない（削除された想定）
      // ただし新しいキャッシュパスも存在しない
      vi.mocked(existsSync).mockReturnValue(false);

      // 2回目: lastHandleのファイルが無い → baseCachePathはundefined
      await externalController.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
        data: [{ type: 'text', content: 'message 1' }],
      });

      const [, , basePath2] = mockProcess.cachePrefill.mock.calls[1];
      expect(basePath2).toBeUndefined();

      await externalController.close();
    });

    it('should discover base cache from index on fresh controller', async () => {
      // インデックスにエントリがある状態でコントローラを作成
      const instructions = [{ type: 'text', content: 'system prompt' }];
      const instructionHash = require('node:crypto')
        .createHash('sha256')
        .update(JSON.stringify(instructions[0]))
        .digest('hex');

      const existingKey = require('node:crypto')
        .createHash('sha256')
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

      // readFileSyncでインデックスを返す
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(indexData));
      // existsSyncの設定: indexPathとキャッシュファイルは存在する
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('cache-index.json')) return true;
        if (pathStr.endsWith(`${existingKey}.safetensors`)) return true;
        return false;
      });

      const freshController = new MlxCacheController({ cacheDir: '/cache' });
      freshController.bind(mockProcess as any, {});

      // 新しいprepare: instructionsは同じ + data追加 → インデックスからbase cache発見
      await freshController.prepare({
        model: 'test-model',
        instructions,
        data: [{ type: 'text', content: 'message 1' }],
      });

      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
      const [, , basePath] = mockProcess.cachePrefill.mock.calls[0];
      expect(basePath).toMatch(new RegExp(`${existingKey}\\.safetensors$`));

      await freshController.close();
    });

    it('should save index to file after cache creation for external dir', async () => {
      const externalController = new MlxCacheController({ cacheDir: '/cache' });
      externalController.bind(mockProcess as any, {});

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
  });
});
