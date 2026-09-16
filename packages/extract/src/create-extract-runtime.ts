import type { MlxBackendMode } from '@modular-prompt/driver';
import { createMlxExtractRuntime } from './create-mlx-extract-runtime.js';
import { createPytorchExtractRuntime } from './create-pytorch-extract-runtime.js';
import {
  resolveMergedModels,
  resolveModelSpec,
  type ExtractProvider,
} from './model-resolution.js';
import type { ExtractRuntime } from './extract-runtime-types.js';

export interface ExtractRuntimeOptions {
  /** Model alias or provider-specific model ID. */
  model?: string;
  /** Explicit provider for raw IDs or persisted store validation. */
  provider?: ExtractProvider;
  /** Fixed cache directory. When omitted, a managed temp directory is used. */
  cacheDir?: string;
  /** MLX backend; ignored for PyTorch. */
  backend?: MlxBackendMode;
  /** MLX VLM image resize limit; ignored for PyTorch. */
  maxImageSize?: number;
}

/**
 * Create the cache-capable runtime selected by the resolved model provider.
 * The original model reference is passed to the provider runtime so alias
 * driverOptions (device, venvPath, backend, and so on) are preserved.
 */
export async function createExtractRuntime(
  options: ExtractRuntimeOptions,
): Promise<ExtractRuntime> {
  const resolved = resolveModelSpec(
    options.model,
    resolveMergedModels(),
    options.provider,
  );

  if (resolved.provider === 'mlx') {
    return createMlxExtractRuntime({
      model: options.model,
      ...(options.backend !== undefined ? { backend: options.backend } : {}),
      ...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
      ...(options.maxImageSize !== undefined ? { maxImageSize: options.maxImageSize } : {}),
    });
  }

  if (resolved.provider === 'pytorch') {
    return createPytorchExtractRuntime({
      model: options.model,
      ...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
    });
  }

  throw new Error(
    `Extract supports MLX and PyTorch models, but '${resolved.model}' uses provider '${resolved.provider}'`,
  );
}
