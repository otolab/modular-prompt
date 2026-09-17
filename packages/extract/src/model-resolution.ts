import {
  AIService,
  inferProvider,
  resolveModelName,
  resolveModelReference,
  type AIDriver,
  type MlxBackendMode,
  type ModelSpec,
  type ModelsConfig,
  type MlxModelDriverOptions,
  type PyTorchModelDriverOptions,
  type PromptCacheController,
} from '@modular-prompt/driver';
import { BUNDLED_MODELS_CONFIG } from './default-models.js';
import type { ExtractProvider } from './extract-runtime-types.js';

export type { ExtractProvider } from './extract-runtime-types.js';

/** createDriver に渡す extract 固有の runtime オプション */
export interface ExtractDriverOptions {
  /** セッションと共有する KV cache controller */
  cacheController?: PromptCacheController;
  /** Explicit extract provider, used for raw model IDs and store validation. */
  provider?: ExtractProvider;
  /** Persisted or explicitly selected MLX backend for extract. */
  backend?: MlxBackendMode;
  /** VLM image resize limit for driver/cache alignment. */
  maxImageSize?: number;
}

export interface ExtractDriverResult {
  driver: AIDriver;
  /** alias 解決後の生 model ID */
  spec: ModelSpec;
}

export function isExtractProvider(value: unknown): value is ExtractProvider {
  return value === 'mlx' || value === 'pytorch';
}

function createAIService(): AIService {
  return AIService.fromMergedConfig(BUNDLED_MODELS_CONFIG, undefined, { mode: 'merge' });
}

/** user models.yaml を含む models 設定を解決する（user の default/alias を使用）。 */
export function resolveMergedModels(): ModelsConfig {
  return createAIService().modelsConfig;
}

/**
 * extract で使用する ModelSpec を解決する。
 *
 * 優先順位は明示 model（alias または生 ID）→ models.default。
 * 同梱の暗黙 default や models の先頭エントリは使用しない。
 */
export function resolveModelSpec(
  model: string | undefined,
  models: ModelsConfig = resolveMergedModels(),
  provider?: ExtractProvider,
): ModelSpec {
  const explicitModel = model?.trim();
  if (explicitModel) {
    const alias = resolveModelReference({ ref: explicitModel }, models);
    if (alias) {
      if (provider && alias.provider !== provider) {
        throw providerMismatchError(alias.model, provider, alias.provider);
      }
      return alias;
    }

    // Validate raw IDs against exact models.yaml matches when one exists.
    // An explicit provider makes otherwise unconfigured raw IDs usable.
    if (provider) {
      const matchingEntry = Object.values(models.models ?? {})
        .find(entry => entry.model === explicitModel);
      if (matchingEntry) {
        const configured = resolveModelName(explicitModel, models, inferProvider);
        if (configured.provider !== provider) {
          throw providerMismatchError(explicitModel, provider, configured.provider);
        }
        return configured;
      }
      return {
        model: explicitModel,
        provider,
        capabilities: [],
      };
    }

    return resolveModelName(explicitModel, models, inferProvider);
  }

  const configuredDefault = resolveModelReference({ ref: 'default' }, models);
  if (configuredDefault) {
    if (provider && configuredDefault.provider !== provider) {
      throw providerMismatchError(configuredDefault.model, provider, configuredDefault.provider);
    }
    return configuredDefault;
  }

  throw new Error(
    'No model configured: specify -m <model-id-or-alias> '
    + 'or define models.default in ~/.modular-prompt/models.yaml',
  );
}

function providerMismatchError(
  model: string,
  expected: ExtractProvider,
  actual: string,
): Error {
  return new Error(
    `Extract provider mismatch for model '${model}': expected '${expected}', got '${actual}'`,
  );
}

function withExtractDriverOptions(
  spec: ModelSpec,
  options: ExtractDriverOptions,
): ModelSpec {
  if (spec.provider === 'mlx') {
    const existingDriverOptions = spec.driverOptions as MlxModelDriverOptions | undefined;
    // Preserve a model's explicit backend and let MLX auto-detect when none is
    // configured.  In particular, extract must not force a VLM model through
    // the mlx-lm backend just to enable prompt caching.
    const backend = options.backend ?? spec.backend ?? existingDriverOptions?.backend ?? 'auto';
    const maxImageSize = options.maxImageSize ?? existingDriverOptions?.maxImageSize;
    const driverOptions: MlxModelDriverOptions = {
      ...existingDriverOptions,
      backend,
      ...(maxImageSize !== undefined ? { maxImageSize } : {}),
      ...(options.cacheController ? { cacheController: options.cacheController } : {}),
    };

    return {
      ...spec,
      backend,
      driverOptions,
    };
  }

  if (spec.provider === 'pytorch') {
    const existingDriverOptions = spec.driverOptions as PyTorchModelDriverOptions | undefined;
    // MLX-only backend/image options intentionally do not cross into the
    // text-only PyTorch runtime. Keep PyTorch-specific options intact.
    const pytorchSpec = { ...spec };
    delete pytorchSpec.backend;
    const driverOptions: PyTorchModelDriverOptions = {
      ...(existingDriverOptions?.venvPath !== undefined
        ? { venvPath: existingDriverOptions.venvPath }
        : {}),
      ...(existingDriverOptions?.device !== undefined
        ? { device: existingDriverOptions.device }
        : {}),
      ...(existingDriverOptions?.cacheDir !== undefined
        ? { cacheDir: existingDriverOptions.cacheDir }
        : {}),
      ...(options.cacheController ? { cacheController: options.cacheController } : {}),
    };

    return {
      ...pytorchSpec,
      driverOptions,
    };
  }

  throw new Error(
    `Extract supports MLX and PyTorch models, but '${spec.model}' uses provider '${spec.provider}'`,
  );
}

/**
 * ModelSpec を AIService 経由で extract 対応 driver に変換する。
 * runtime が作成した cache controller は driver と共有する。
 */
export async function createDriver(
  model: string | undefined,
  options: ExtractDriverOptions = {},
): Promise<ExtractDriverResult> {
  const ai = createAIService();
  const spec = withExtractDriverOptions(
    resolveModelSpec(model, ai.modelsConfig, options.provider),
    options,
  );
  const driver = await ai.createDriver(spec);
  return { driver, spec };
}
