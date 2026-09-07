import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver, CacheHandle, PromptCacheController } from '@modular-prompt/driver';
import { partitionPrompt } from '@modular-prompt/driver';
import type { ExtractCorpus, ExtractRequest } from './types.js';
import { compileExtractPrompt } from './compile-extract-prompt.js';

export interface CacheLifecycleState {
  handle: CacheHandle | null;
  controllerReady: boolean;
}

export interface PrepareSessionCacheOptions {
  /** Reject an empty cache handle instead of falling back to an uncached query. */
  required?: boolean;
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
  options: PrepareSessionCacheOptions = {},
): Promise<CacheHandle | null> {
  const compiled = compileExtractPrompt(sessionBaseModule, corpus, request, baseModule);
  const { cacheable } = partitionPrompt(compiled);
  const hasCacheableContent =
    cacheable.instructions.length > 0 || cacheable.data.length > 0;

  if (!hasCacheableContent) {
    if (options.required && !state.handle) {
      throw new Error('Required cache preparation failed: prompt has no cacheable content');
    }
    return state.handle;
  }

  const newHandle = await cacheController.prepare({
    model,
    instructions: cacheable.instructions,
    data: cacheable.data,
    tools: request.options?.tools,
    reasoningEffort: request.options?.reasoningEffort,
  });

  if (!newHandle.ref) {
    if (options.required) {
      throw new Error(
        'Required cache preparation failed: cache controller returned an empty handle',
      );
    }
    state.handle = null;
    return state.handle;
  }

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
