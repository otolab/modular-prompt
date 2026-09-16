import {
  MlxCacheController,
  type AIDriver,
  type MlxBackendMode,
  type PromptCacheController,
  type MlxModelDriverOptions,
} from '@modular-prompt/driver';
import { createDriver } from './model-resolution.js';
import type { ExtractRuntime } from './extract-runtime-types.js';

export interface MlxExtractRuntimeOptions {
  /** MLX model ID or alias in models.yaml. Omitted uses user-configured models.default. */
  model?: string;
  /** Explicit MLX backend. Omitted preserves model config and defaults to `auto`. */
  backend?: MlxBackendMode;
  /** Fixed cache directory. When omitted, a managed temp directory is used. */
  cacheDir?: string;
  /** VLM image resize limit. Omitted uses the model configuration or 768. */
  maxImageSize?: number;
}

/**
 * MLX driver + cache controller bundle for extract sessions.
 * Preserves the configured MLX backend and defaults to `auto`, so text-only
 * VLM classification models can use the same disk-backed cache path as LM
 * models.  Image-bearing materials use the VLM vision-cache namespace and
 * sidecar when the resolved backend is VLM; VLM incremental prefill remains
 * unsupported.
 * Lifecycle (close) is owned by the caller — not by ExtractSession.
 */
export interface MlxExtractRuntime extends ExtractRuntime {
  provider: 'mlx';
  /** Backend selected for this runtime; persisted by extract stores. */
  backend: MlxBackendMode;
  /** VLM image resize limit used by the driver and cache prefill. */
  maxImageSize: number;
  /** Release driver and cache controller when all sessions using this runtime are done. */
  close(): Promise<void>;
}

/**
 * Runtime construction failed after resources started being created.
 * Cleanup must not replace the error that explains why construction failed.
 */
async function closeFailedRuntime(
  driver: AIDriver | undefined,
  cacheController: PromptCacheController,
): Promise<void> {
  try {
    if (driver) {
      await driver.close();
    }
  } catch {
    // Preserve the original runtime construction/capabilities error.
  }

  try {
    await cacheController.close();
  } catch {
    // Preserve the original runtime construction/capabilities error.
  }
}

export async function createMlxExtractRuntime(
  options: MlxExtractRuntimeOptions,
): Promise<MlxExtractRuntime> {
  const cacheController = new MlxCacheController(
    options.cacheDir ? { cacheDir: options.cacheDir } : undefined,
  );
  let driverForCleanup: AIDriver | undefined;
  try {
    const resolved = await createDriver(options.model, {
      cacheController,
      provider: 'mlx',
      backend: options.backend,
      maxImageSize: options.maxImageSize,
    });
    const driver = resolved.driver;
    driverForCleanup = driver;
    const driverOptions = resolved.spec.driverOptions as MlxModelDriverOptions | undefined;
    const maxImageSize = options.maxImageSize ?? driverOptions?.maxImageSize ?? 768;

    if ('getCapabilities' in driver && typeof driver.getCapabilities === 'function') {
      await driver.getCapabilities();
    }

    return {
      driver,
      cacheController,
      model: resolved.spec.model,
      provider: 'mlx',
      backend: resolved.spec.backend ?? 'auto',
      maxImageSize,
      async close() {
        try {
          await driver.close();
        } finally {
          await cacheController.close();
        }
      },
    };
  } catch (error) {
    await closeFailedRuntime(driverForCleanup, cacheController);
    throw error;
  }
}
