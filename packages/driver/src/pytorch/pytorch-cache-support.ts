import type { FormatterOptions } from '../formatter/types.js';
import type { InferenceMessage } from '../local-inference/protocol.js';
import type {
  CachePrepareHandle,
  LocalInferenceCacheSupport,
} from '../local-inference/adapters.js';
import type { InferenceProcessPort } from '../local-inference/process-port.js';
import type { PromptCacheController } from '../cache-controller.js';
import { PyTorchCacheController } from './pytorch-cache-controller.js';

/**
 * PyTorch 向け KV キャッシュ連携を構築する。
 * `PromptCacheController` が `PyTorchCacheController` でない場合は
 * undefined（旧挙動と同様）。PyTorch backend は現状 VLM をサポートしない。
 */
export function createPytorchCacheSupport(
  controller: PromptCacheController,
): LocalInferenceCacheSupport | undefined {
  if (!(controller instanceof PyTorchCacheController)) {
    return undefined;
  }

  const pytorchCache = controller;
  return {
    setModelKind: (modelKind) => pytorchCache.setModelKind(modelKind),
    async bind(process, formatterOptions, preprocess) {
      await pytorchCache.bind(
        process as Parameters<PyTorchCacheController['bind']>[0],
        formatterOptions,
        preprocess,
      );
    },
    shouldDisableForVlm: (modelKind) => modelKind === 'vlm',
    recordQuery: () => pytorchCache.recordQuery?.(),
    getGrowthBefore: () => pytorchCache.getStats().cacheGrowthTokens,
    getWriteTokensSince: (growthBefore) =>
      Math.max(0, pytorchCache.getStats().cacheGrowthTokens - growthBefore),
    prepare: (params) => pytorchCache.prepare(params) as Promise<CachePrepareHandle>,
    readTokenCount: (cachePath) => pytorchCache.readCacheTokenCount(cachePath),
    recordPromptTokens: (promptTokens, cacheTokensUsed) => {
      pytorchCache.recordPromptTokens(promptTokens, cacheTokensUsed);
    },
    logStats: () => {
      // PyTorchDriver.close() logs controller-specific statistics.
    },
    close: () => pytorchCache.close(),
  };
}

export function bindPytorchCacheOnCapabilitiesLoaded(
  cache: LocalInferenceCacheSupport,
  cacheBound: { bound: boolean },
  runtimeInfo: { model_kind?: 'lm' | 'vlm' },
  ctx: {
    process: InferenceProcessPort;
    formatterOptions: FormatterOptions;
    modelProcessor: {
      applyChatSpecificProcessing(messages: InferenceMessage[]): InferenceMessage[];
    };
  },
  onVlmDisabled?: () => void,
): Promise<void> {
  if (cacheBound.bound) {
    return Promise.resolve();
  }

  cache.setModelKind?.(runtimeInfo.model_kind);
  if (cache.shouldDisableForVlm(runtimeInfo.model_kind)) {
    onVlmDisabled?.();
    return Promise.resolve();
  }

  return cache
    .bind(ctx.process, ctx.formatterOptions, (messages) =>
      ctx.modelProcessor.applyChatSpecificProcessing(messages),
    )
    .then(() => {
      cacheBound.bound = true;
    });
}
