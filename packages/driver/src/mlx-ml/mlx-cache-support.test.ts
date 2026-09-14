import { describe, expect, it, vi } from 'vitest';
import { MlxCacheController } from './mlx-cache-controller.js';
import {
  bindMlxCacheOnCapabilitiesLoaded,
  createMlxCacheSupport,
} from './mlx-cache-support.js';

describe('MLX cache support', () => {
  it('binds VLM caches without disabling them', async () => {
    const controller = new MlxCacheController({ cacheDir: '/ignored-for-vlm' });
    const support = createMlxCacheSupport(controller);
    expect(support).toBeDefined();
    expect(support?.shouldDisableForVlm('vlm')).toBe(false);

    const process = {
      cachePrefill: vi.fn().mockResolvedValue({
        cache_path: 'mlx-vlm-memory://backend-ref',
        token_count: 4,
      }),
    };
    const cacheBound = { bound: false };

    await bindMlxCacheOnCapabilitiesLoaded(
      support!,
      cacheBound,
      { model_kind: 'vlm' },
      {
        process: process as never,
        formatterOptions: {},
        modelProcessor: { applyChatSpecificProcessing: (messages) => messages },
      },
    );

    expect(cacheBound.bound).toBe(true);
    const handle = await support!.prepare({
      model: 'test-vlm',
      instructions: [{ type: 'text', content: 'cached' }],
    });
    expect(handle.ref).toMatch(/^mlx-vlm-memory:\/\//);
    expect(support!.readTokenCount(handle.ref)).toBe(4);

    await support!.close();
  });
});
