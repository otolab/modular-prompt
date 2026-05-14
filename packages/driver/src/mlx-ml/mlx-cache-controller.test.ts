import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MlxCacheController } from './mlx-cache-controller.js';

function createMockProcess() {
  return {
    cachePrefill: vi.fn().mockResolvedValue({ cache_id: 'mlx-cache-abc' }),
    cacheDelete: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('MlxCacheController', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;
  let controller: MlxCacheController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockProcess();
    controller = new MlxCacheController(mockProcess as any);
  });

  describe('prepare', () => {
    it('should create cache with instructions', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'Be helpful' }],
      });

      expect(handle.ref).toMatch(/^mlx-cache-/);
      expect(handle.includes.instructions).toBe(true);
      expect(handle.includes.dataElementCount).toBe(0);
      expect(handle.includes.tools).toBe(false);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
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

    it('should handle empty instructions and data', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
      });

      expect(handle.includes.instructions).toBe(false);
      expect(handle.includes.dataElementCount).toBe(0);
    });

    it('should coalesce concurrent calls with identical params', async () => {
      let resolvePrefill: (val: { cache_id: string }) => void;
      mockProcess.cachePrefill.mockReturnValueOnce(
        new Promise(resolve => { resolvePrefill = resolve; })
      );

      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };

      const p1 = controller.prepare(params);
      const p2 = controller.prepare(params);

      resolvePrefill!({ cache_id: 'mlx-cache-coalesced' });

      const [h1, h2] = await Promise.all([p1, p2]);
      expect(h1.ref).toBe(h2.ref);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(1);
    });

    it('should pass formatted messages to process.cachePrefill', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'system prompt' }],
        data: [{ type: 'material', id: 'm1', title: 'Doc', content: 'content' }],
      });

      const [cacheId, messages] = mockProcess.cachePrefill.mock.calls[0];
      expect(cacheId).toMatch(/^mlx-cache-/);
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('invalidate', () => {
    it('should delete the cached content', async () => {
      const handle = await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'prompt' }],
      });

      await controller.invalidate(handle);
      expect(mockProcess.cacheDelete).toHaveBeenCalledWith(handle.ref);
    });

    it('should allow re-creation after invalidation', async () => {
      const params = {
        model: 'test-model',
        instructions: [{ type: 'text' as const, content: 'prompt' }],
      };

      const handle1 = await controller.prepare(params);
      await controller.invalidate(handle1);

      const handle2 = await controller.prepare(params);
      expect(mockProcess.cachePrefill).toHaveBeenCalledTimes(2);
    });
  });

  describe('close', () => {
    it('should delete all managed caches', async () => {
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'a' }],
      });
      await controller.prepare({
        model: 'test-model',
        instructions: [{ type: 'text', content: 'b' }],
      });

      await controller.close();
      expect(mockProcess.cacheDelete).toHaveBeenCalledTimes(2);
    });
  });
});
