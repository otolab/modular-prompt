import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver, CacheHandle, PromptCacheController } from '@modular-prompt/driver';
import { partitionPrompt } from '@modular-prompt/driver';
import type { ExtractCorpus, ExtractRequest } from './types.js';
import { compileExtractPrompt } from './compile-extract-prompt.js';

export interface CacheLifecycleState {
  handle: CacheHandle | null;
  controllerReady: boolean;
}

export async function ensureCacheControllerReady(
  driver: AIDriver,
  state: CacheLifecycleState,
): Promise<void> {
  if (state.controllerReady) {
    return;
  }

  if ('getCapabilities' in driver && typeof driver.getCapabilities === 'function') {
    await driver.getCapabilities();
  }

  state.controllerReady = true;
}

export async function prepareSessionCache<TContext>(
  cacheController: PromptCacheController,
  model: string,
  sessionBaseModule: PromptModule<TContext>,
  corpus: ExtractCorpus,
  request: ExtractRequest,
  baseModule: PromptModule<TContext> | undefined,
  state: CacheLifecycleState,
): Promise<CacheHandle | null> {
  const compiled = compileExtractPrompt(sessionBaseModule, corpus, request, baseModule);
  const { cacheable } = partitionPrompt(compiled);
  const hasCacheableContent =
    cacheable.instructions.length > 0 || cacheable.data.length > 0;

  if (!hasCacheableContent) {
    return state.handle;
  }

  const newHandle = await cacheController.prepare({
    model,
    instructions: cacheable.instructions,
    data: cacheable.data,
    tools: request.options?.tools,
    reasoningEffort: request.options?.reasoningEffort,
  });

  if (state.handle?.ref && newHandle.supersedes === state.handle.ref) {
    cacheController.release(state.handle.ref);
  }

  state.handle = newHandle.ref ? newHandle : null;
  return state.handle;
}

export function releaseSessionCache(
  cacheController: PromptCacheController,
  state: CacheLifecycleState,
): void {
  if (state.handle?.ref) {
    cacheController.release(state.handle.ref);
    state.handle = null;
  }
}
