import type { FormatterOptions } from '../formatter/types.js';
import type { InferenceMessage } from '../local-inference/protocol.js';
import type {
  CachePrepareHandle,
  LocalInferenceCacheSupport,
} from '../local-inference/adapters.js';
import type { InferenceProcessPort } from '../local-inference/process-port.js';
import { MlxCacheController } from './mlx-cache-controller.js';
import type { PromptCacheController } from '../cache-controller.js';

/**
 * MLX 向け KV キャッシュ連携を構築する。
 * `PromptCacheController` が `MlxCacheController` でない場合は undefined（旧挙動と同様）。
 * PyTorch 等の別バックエンド用 adapter は将来ここに並列で追加する。
 */
export function createMlxCacheSupport(
  controller: PromptCacheController,
): LocalInferenceCacheSupport | undefined {
  if (!(controller instanceof MlxCacheController)) {
    return undefined;
  }

  const mlxCache = controller;
  return {
    async bind(process, formatterOptions, preprocess) {
      await mlxCache.bind(
        process as Parameters<MlxCacheController['bind']>[0],
        formatterOptions,
        preprocess,
      );
    },
    shouldDisableForVlm: (modelKind) => modelKind === 'vlm',
    recordQuery: () => mlxCache.recordQuery?.(),
    getGrowthBefore: () => mlxCache.getStats().cacheGrowthTokens,
    getWriteTokensSince: (growthBefore) =>
      Math.max(0, mlxCache.getStats().cacheGrowthTokens - growthBefore),
    prepare: (params) => mlxCache.prepare(params) as Promise<CachePrepareHandle>,
    readTokenCount: (cachePath) => mlxCache.readCacheTokenCount(cachePath),
    recordPromptTokens: (promptTokens, cacheTokensUsed) => {
      mlxCache.recordPromptTokens(promptTokens, cacheTokensUsed);
    },
    logStats: () => {
      // MlxDriver.close() で QueryLogger 経由のログを行う
    },
    close: () => mlxCache.close(),
  };
}

export function bindMlxCacheOnCapabilitiesLoaded(
  cache: LocalInferenceCacheSupport,
  cacheBound: { bound: boolean },
  runtimeInfo: { model_kind?: 'lm' | 'vlm' },
  ctx: {
    process: InferenceProcessPort;
    formatterOptions: FormatterOptions;
    modelProcessor: { applyChatSpecificProcessing(messages: InferenceMessage[]): InferenceMessage[] };
  },
  onVlmDisabled: () => void,
): Promise<void> {
  if (cacheBound.bound) {
    return Promise.resolve();
  }
  if (cache.shouldDisableForVlm(runtimeInfo.model_kind)) {
    onVlmDisabled();
    return Promise.resolve();
  }
  return cache
    .bind(ctx.process, ctx.formatterOptions, (msgs) =>
      ctx.modelProcessor.applyChatSpecificProcessing(msgs),
    )
    .then(() => {
      cacheBound.bound = true;
    });
}
