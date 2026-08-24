import { vi } from 'vitest';
import type { CacheHandle, CachePrepareParams, PromptCacheController } from '@modular-prompt/driver';

export function createMockCacheController(): {
  controller: PromptCacheController;
  prepares: CachePrepareParams[];
  releases: string[];
} {
  const prepares: CachePrepareParams[] = [];
  const releases: string[] = [];
  let counter = 0;

  const controller: PromptCacheController = {
    prepare: vi.fn(async (params) => {
      prepares.push(params);
      counter += 1;
      const handle: CacheHandle = {
        ref: `cache-${counter}`,
        includes: {
          instructions: (params.instructions?.length ?? 0) > 0,
          dataElementCount: params.data?.length ?? 0,
          tools: (params.tools?.length ?? 0) > 0,
        },
        supersedes: counter > 1 ? `cache-${counter - 1}` : undefined,
      };
      return handle;
    }),
    release: vi.fn((ref: string) => {
      releases.push(ref);
    }),
    close: vi.fn(async () => {}),
  };

  return { controller, prepares, releases };
}
