import type {
  AIDriver,
  MlxBackendMode,
  PromptCacheController,
} from '@modular-prompt/driver';

/** Providers that can persist the cache format used by extract stores. */
export type ExtractProvider = 'mlx' | 'pytorch';

/** Common driver/cache bundle consumed by an extract session or store. */
export interface ExtractRuntime {
  driver: AIDriver;
  cacheController: PromptCacheController;
  model: string;
  provider: ExtractProvider;
  /** MLX backend selected for this runtime; undefined for PyTorch. */
  backend?: MlxBackendMode;
  /** VLM image resize limit; undefined for text-only PyTorch. */
  maxImageSize?: number;
  close(): Promise<void>;
}
