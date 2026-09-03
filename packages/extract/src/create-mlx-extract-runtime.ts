import {
  MlxCacheController,
  type AIDriver,
  type PromptCacheController,
} from '@modular-prompt/driver';
import { createDriver } from './model-resolution.js';

export interface MlxExtractRuntimeOptions {
  /** MLX model ID or alias in models.yaml. Omitted uses the resolved default. */
  model?: string;
  /** Fixed cache directory. When omitted, a managed temp directory is used. */
  cacheDir?: string;
}

/**
 * MLX driver + cache controller bundle for extract sessions.
 * Always uses mlx-lm backend (`backend: 'lm'`) — VLM auto-selection disables prompt cache.
 * Lifecycle (close) is owned by the caller — not by ExtractSession.
 */
export interface MlxExtractRuntime {
  driver: AIDriver;
  cacheController: PromptCacheController;
  model: string;
  /** Release driver and cache controller when all sessions using this runtime are done. */
  close(): Promise<void>;
}

export async function createMlxExtractRuntime(
  options: MlxExtractRuntimeOptions,
): Promise<MlxExtractRuntime> {
  const cacheController = new MlxCacheController(
    options.cacheDir ? { cacheDir: options.cacheDir } : undefined,
  );
  try {
    const { driver, spec } = await createDriver(options.model, { cacheController });

    if ('getCapabilities' in driver && typeof driver.getCapabilities === 'function') {
      await driver.getCapabilities();
    }

    return {
      driver,
      cacheController,
      model: spec.model,
      async close() {
        try {
          await driver.close();
        } finally {
          await cacheController.close();
        }
      },
    };
  } catch (error) {
    await cacheController.close();
    throw error;
  }
}
