import { describe, expect, it, vi } from 'vitest';
import type { PromptCacheController } from '../cache-controller.js';
import { PyTorchCacheController } from './pytorch-cache-controller.js';
import {
  bindPytorchCacheOnCapabilitiesLoaded,
  createPytorchCacheSupport,
} from './pytorch-cache-support.js';

describe('PyTorch cache support', () => {
  it('only adapts PyTorchCacheController and disables VLM caches', async () => {
    const controller = new PyTorchCacheController();
    const support = createPytorchCacheSupport(controller);

    expect(support).toBeDefined();
    expect(support?.shouldDisableForVlm('lm')).toBe(false);
    expect(support?.shouldDisableForVlm('vlm')).toBe(true);
    expect(createPytorchCacheSupport({} as PromptCacheController)).toBeUndefined();

    await controller.close();
  });

  it('binds the controller once capabilities are loaded', async () => {
    const controller = new PyTorchCacheController();
    const support = createPytorchCacheSupport(controller);
    const process = {
      tokenize: vi.fn().mockResolvedValue({ token_ids: [1], token_count: 1, error: null }),
      cachePrefill: vi.fn().mockResolvedValue({ token_count: 1 }),
    };
    const cacheBound = { bound: false };

    await bindPytorchCacheOnCapabilitiesLoaded(
      support!,
      cacheBound,
      { model_kind: 'lm' },
      {
        process: process as never,
        formatterOptions: {},
        modelProcessor: {
          applyChatSpecificProcessing: (messages) => messages,
        },
      },
    );

    expect(cacheBound.bound).toBe(true);
    await support!.close();
  });

  it('does not bind a VLM controller and invokes the disable callback', async () => {
    const controller = new PyTorchCacheController();
    const support = createPytorchCacheSupport(controller);
    const onVlmDisabled = vi.fn();
    const cacheBound = { bound: false };

    await bindPytorchCacheOnCapabilitiesLoaded(
      support!,
      cacheBound,
      { model_kind: 'vlm' },
      {
        process: {} as never,
        formatterOptions: {},
        modelProcessor: {
          applyChatSpecificProcessing: (messages) => messages,
        },
      },
      onVlmDisabled,
    );

    expect(onVlmDisabled).toHaveBeenCalledOnce();
    expect(cacheBound.bound).toBe(false);
    await controller.close();
  });
});
