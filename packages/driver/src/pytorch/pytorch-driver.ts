import { LocalInferenceDriver } from '../local-inference/driver.js';
import type { InferenceCapabilities } from '../local-inference/protocol.js';
import type { FormatterOptions } from '../formatter/types.js';
import type { PromptCacheController } from '../cache-controller.js';
import type { PyTorchQueryOptions } from './pytorch-options.js';
import { PyTorchProcess } from './process/index.js';
import { pytorchLocalInferenceAdapters } from './pytorch-local-inference-adapters.js';
import {
  bindPytorchCacheOnCapabilitiesLoaded,
  createPytorchCacheSupport,
} from './pytorch-cache-support.js';
import { PyTorchCacheController } from './pytorch-cache-controller.js';

export interface PyTorchModelCapabilities {
  methods: InferenceCapabilities['methods'];
  specialTokens: InferenceCapabilities['special_tokens'];
  features: {
    hasChatTemplate: boolean;
    vocabSize?: number;
    modelMaxLength?: number;
    chatTemplate?: InferenceCapabilities['features']['chat_template'];
  };
  chatRestrictions?: InferenceCapabilities['chat_restrictions'];
}

export interface PyTorchDriverConfig {
  model: string;
  defaultOptions?: Partial<PyTorchQueryOptions>;
  formatterOptions?: FormatterOptions;
  /** 外部 venv パス（未指定時は ~/.modular-prompt/runtimes/pytorch/.venv） */
  venvPath?: string;
  /** PYTORCH_DEVICE（例: cpu, cuda）。未指定時は template の既定値（cpu/cuda） */
  device?: string;
  /** 外部で生成したキャッシュコントローラー */
  cacheController?: PromptCacheController;
}

/**
 * Transformers + PyTorch バックエンド（LIP）。
 * 共通ロジックは LocalInferenceDriver に委譲する。
 */
export class PyTorchDriver extends LocalInferenceDriver {
  private cacheControllerRaw?: PromptCacheController;
  private readonly cacheBindingState = { bound: false };

  constructor(config: PyTorchDriverConfig) {
    const process = new PyTorchProcess(config.model, {
      venvPath: config.venvPath,
      device: config.device,
    });
    const cacheSupport = config.cacheController
      ? createPytorchCacheSupport(config.cacheController)
      : undefined;

    super({
      model: config.model,
      process,
      adapters: pytorchLocalInferenceAdapters,
      formatterOptions: config.formatterOptions,
      defaultOptions: config.defaultOptions,
      loggerPrefix: 'PyTorch',
      cache: cacheSupport,
      onCapabilitiesLoaded: async (runtimeInfo, ctx) => {
        if (!cacheSupport) return;
        await bindPytorchCacheOnCapabilitiesLoaded(
          cacheSupport,
          this.cacheBindingState,
          runtimeInfo,
          ctx,
          () => {
            this.queryLogger.log.info('PyTorch cache is disabled for this model');
            this.disableCacheSupport();
          },
        );
      },
    });

    this.cacheControllerRaw = config.cacheController;
  }

  get defaultOptions(): Partial<PyTorchQueryOptions> {
    return super.defaultOptions as Partial<PyTorchQueryOptions>;
  }

  set defaultOptions(value: Partial<PyTorchQueryOptions>) {
    super.defaultOptions = value ?? {};
  }

  async getCapabilities(): Promise<PyTorchModelCapabilities> {
    await this.ensureInitialized();

    const runtimeInfo = this.getRuntimeInfo();
    if (!runtimeInfo) {
      throw new Error('Failed to retrieve model capabilities');
    }

    return {
      methods: runtimeInfo.methods,
      specialTokens: runtimeInfo.special_tokens,
      features: {
        hasChatTemplate: runtimeInfo.features.apply_chat_template,
        vocabSize: runtimeInfo.features.vocab_size,
        modelMaxLength: runtimeInfo.features.model_max_length,
        chatTemplate: runtimeInfo.features.chat_template,
      },
      chatRestrictions: runtimeInfo.chat_restrictions,
    };
  }

  override async close(): Promise<void> {
    this.logCacheStats();
    await super.close();
  }

  private logCacheStats(): void {
    if (!(this.cacheControllerRaw instanceof PyTorchCacheController)) return;
    const stats = this.cacheControllerRaw.getStats();
    if (stats.totalQueries === 0) return;

    const queryBreakdown =
      stats.incremental + stats.fresh > 0
        ? ` (incremental ${stats.incremental}, fresh ${stats.fresh})`
        : '';
    const parts: string[] = [`cache stats: ${stats.totalQueries} queries${queryBreakdown}`];
    if (stats.totalPromptTokens > 0) {
      const reusedRate = ((stats.prefillReusedTokens / stats.totalPromptTokens) * 100).toFixed(0);
      parts.push(
        `prompt ${stats.totalPromptTokens} tokens, ${stats.prefillReusedTokens} reused (${reusedRate}%)`,
      );
    }
    if (stats.cacheGrowthTokens > 0) {
      parts.push(`cache +${stats.cacheGrowthTokens} tokens`);
    }
    this.queryLogger.log.verbose(parts.join(' | '));
  }
}
