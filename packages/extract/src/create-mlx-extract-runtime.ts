import {
  MlxCacheController,
  MlxDriver,
  type AIDriver,
  type PromptCacheController,
} from '@modular-prompt/driver';

export interface MlxExtractRuntimeOptions {
  model: string;
  /** Fixed cache directory. When omitted, a managed temp directory is used. */
  cacheDir?: string;
}

/**
 * MLX driver + cache controller bundle for extract sessions.
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
  const driver = new MlxDriver({
    model: options.model,
    cacheController,
  });

  if ('getCapabilities' in driver && typeof driver.getCapabilities === 'function') {
    await driver.getCapabilities();
  }

  return {
    driver,
    cacheController,
    model: options.model,
    async close() {
      await driver.close();
      await cacheController.close();
    },
  };
}
