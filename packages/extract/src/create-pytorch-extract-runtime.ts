import {
  PyTorchCacheController,
  type AIDriver,
  type PromptCacheController,
} from '@modular-prompt/driver';
import { createDriver } from './model-resolution.js';
import type { ExtractRuntime } from './extract-runtime-types.js';

export interface PyTorchExtractRuntimeOptions {
  /** PyTorch model ID or alias in models.yaml. */
  model?: string;
  /** Fixed cache directory. When omitted, a managed temp directory is used. */
  cacheDir?: string;
}

/** PyTorch driver + persistent cache controller bundle for extract sessions. */
export interface PyTorchExtractRuntime extends ExtractRuntime {
  provider: 'pytorch';
}

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

export async function createPytorchExtractRuntime(
  options: PyTorchExtractRuntimeOptions,
): Promise<PyTorchExtractRuntime> {
  const cacheController = new PyTorchCacheController(
    options.cacheDir ? { cacheDir: options.cacheDir } : undefined,
  );
  let driverForCleanup: AIDriver | undefined;

  try {
    const resolved = await createDriver(options.model, {
      provider: 'pytorch',
      cacheController,
    });
    const driver = resolved.driver;
    driverForCleanup = driver;

    if ('getCapabilities' in driver && typeof driver.getCapabilities === 'function') {
      await driver.getCapabilities();
    }

    return {
      driver,
      cacheController,
      model: resolved.spec.model,
      provider: 'pytorch',
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
