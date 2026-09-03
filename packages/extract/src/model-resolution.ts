import {
  AIService,
  resolveDefaultModelFromConfig,
  resolveModelName,
  resolveModelReference,
  type AIDriver,
  type DriverProvider,
  type ModelSpec,
  type ModelsConfig,
  type MlxModelDriverOptions,
  type PromptCacheController,
} from '@modular-prompt/driver';
import { BUNDLED_MODELS_CONFIG } from './default-models.js';

/** createDriver に渡す extract 固有の runtime オプション */
export interface ExtractDriverOptions {
  /** セッションと共有する KV cache controller */
  cacheController?: PromptCacheController;
}

export interface ExtractDriverResult {
  driver: AIDriver;
  /** alias 解決後の生 model ID */
  spec: ModelSpec;
}

function inferProvider(_model: string): DriverProvider {
  // extract runtime は MLX 専用。生の model ID は MLX model として扱う。
  return 'mlx';
}

function createAIService(): AIService {
  return AIService.fromMergedConfig(BUNDLED_MODELS_CONFIG, undefined, { mode: 'merge' });
}

/** bundled + user models.yaml を解決する（user の default/alias が優先）。 */
export function resolveMergedModels(): ModelsConfig {
  return createAIService().modelsConfig;
}

/**
 * extract で使用する ModelSpec を解決する。
 *
 * 優先順位は明示 model（alias または生 ID）→ models.default → models の先頭。
 */
export function resolveModelSpec(
  model: string | undefined,
  models: ModelsConfig = resolveMergedModels(),
): ModelSpec {
  const explicitModel = model?.trim();
  if (explicitModel) {
    return resolveModelReference({ ref: explicitModel }, models)
      ?? resolveModelName(explicitModel, models, inferProvider);
  }

  const fallback = resolveDefaultModelFromConfig(models);
  if (fallback) {
    return fallback;
  }

  throw new Error(
    'No extract model configured: specify -m <model-id-or-alias> '
    + 'or define models.default in ~/.modular-prompt/models.yaml',
  );
}

function withExtractDriverOptions(
  spec: ModelSpec,
  options: ExtractDriverOptions,
): ModelSpec {
  if (spec.provider !== 'mlx') {
    throw new Error(
      `Extract requires an MLX model, but '${spec.model}' uses provider '${spec.provider}'`,
    );
  }

  const driverOptions: MlxModelDriverOptions = {
    ...(spec.driverOptions as MlxModelDriverOptions | undefined),
    backend: 'lm',
    ...(options.cacheController ? { cacheController: options.cacheController } : {}),
  };

  return {
    ...spec,
    backend: 'lm',
    driverOptions,
  };
}

/**
 * ModelSpec を AIService 経由で MLX driver に変換する。
 * runtime が作成した cache controller は driver と共有する。
 */
export async function createDriver(
  model: string | undefined,
  options: ExtractDriverOptions = {},
): Promise<ExtractDriverResult> {
  const ai = createAIService();
  const spec = withExtractDriverOptions(resolveModelSpec(model, ai.modelsConfig), options);
  const driver = await ai.createDriver(spec);
  return { driver, spec };
}
