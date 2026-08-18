import { merge, compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver, CacheHandle, PromptCacheController } from '@modular-prompt/driver';
import { partitionPrompt } from '@modular-prompt/driver';
import type { ExtractRequest } from './types.js';
import { buildRequestModule } from './build-modules.js';

export interface CacheLifecycleState {
  handle: CacheHandle | null;
  controllerReady: boolean;
}

export function resolveModelName(model: string | undefined, cacheEnabled: boolean): string | undefined {
  if (!cacheEnabled) {
    return model;
  }
  if (!model) {
    throw new Error('ExtractSessionOptions.model is required when cacheController is set');
  }
  return model;
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

export function buildCacheModule<TContext>(
  sessionBaseModule: PromptModule<TContext>,
  corpusModule: PromptModule,
  request: ExtractRequest,
): PromptModule {
  const requestModule = buildRequestModule(request);
  const { cue: _cue, ...cacheableRequest } = requestModule;
  return merge(sessionBaseModule, corpusModule, cacheableRequest);
}

export async function prepareSessionCache(
  cacheController: PromptCacheController,
  model: string,
  cacheModule: PromptModule,
  request: ExtractRequest,
  state: CacheLifecycleState,
): Promise<CacheHandle | null> {
  const compiled = compile(cacheModule);
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
