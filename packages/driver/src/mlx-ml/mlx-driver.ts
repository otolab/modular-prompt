import { LocalInferenceDriver } from '../local-inference/driver.js';
import { hasMessageElement } from '../local-inference/prompt-utils.js';
import type { PromptCacheController } from '../cache-controller.js';
import type { MlxModelCapabilities } from './types.js';
import type { MlxQueryOptions } from './mlx-options.js';
import type { FormatterOptions } from '../formatter/types.js';
import { MlxProcess } from './process/index.js';
import { mlxLocalInferenceAdapters } from './mlx-local-inference-adapters.js';
import {
  bindMlxCacheOnCapabilitiesLoaded,
  createMlxCacheSupport,
} from './mlx-cache-support.js';
import { MlxCacheController } from './mlx-cache-controller.js';

export { hasMessageElement };

/**
 * MLX ML driver configuration
 */
export interface MlxDriverConfig {
  model: string;
  defaultOptions?: Partial<MlxQueryOptions>;
  formatterOptions?: FormatterOptions;
  /** VLM画像の最大辺ピクセル数（デフォルト: 768） */
  maxImageSize?: number;
  /** VLMモデルをtext-onlyモードで使用する（VLM判定を抑制） */
  textOnly?: boolean;
  /** Speculative decoding用のdrafter model名 */
  drafterModel?: string;
  /** Speculative decoding用のdraft block size（デフォルト: モデル依存） */
  draftBlockSize?: number;
  /** 外部で生成したキャッシュコントローラー */
  cacheController?: PromptCacheController;
}

/**
 * MLX ML driver using Python subprocess.
 * 共通ロジックは LocalInferenceDriver に委譲する。
 */
export class MlxDriver extends LocalInferenceDriver {
  private cacheControllerRaw?: PromptCacheController;
  private cacheDisabledForVlm = false;
  private readonly cacheBindingState = { bound: false };

  constructor(config: MlxDriverConfig) {
    const mlxProcess = new MlxProcess(config.model, {
      textOnly: config.textOnly,
      drafterModel: config.drafterModel,
      draftBlockSize: config.draftBlockSize,
    });
    const cacheSupport = config.cacheController
      ? createMlxCacheSupport(config.cacheController)
      : undefined;

    super({
      model: config.model,
      process: mlxProcess,
      adapters: mlxLocalInferenceAdapters,
      formatterOptions: config.formatterOptions,
      maxImageSize: config.maxImageSize,
      defaultOptions: config.defaultOptions,
      loggerPrefix: 'MLX',
      cache: cacheSupport,
      onCapabilitiesLoaded: async (runtimeInfo, ctx) => {
        if (!cacheSupport) return;
        await bindMlxCacheOnCapabilitiesLoaded(
          cacheSupport,
          this.cacheBindingState,
          runtimeInfo,
          ctx,
          () => {
            this.queryLogger.log.info(
              'VLM models do not support prompt caching — cacheController disabled',
            );
            this.cacheDisabledForVlm = true;
            this.disableCacheSupport();
          },
        );
      },
    });

    this.cacheControllerRaw = config.cacheController;

    if (config.drafterModel) {
      this.queryLogger.log.info(`Drafter model: ${config.drafterModel}`);
    }
  }

  get defaultOptions(): Partial<MlxQueryOptions> {
    return super.defaultOptions as Partial<MlxQueryOptions>;
  }

  set defaultOptions(value: Partial<MlxQueryOptions>) {
    super.defaultOptions = value ?? {};
  }

  /**
   * Get model capabilities (public API)
   *
   * Returns runtime information converted to camelCase
   */
  async getCapabilities(): Promise<MlxModelCapabilities> {
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
        chatTemplate: runtimeInfo.features.chat_template
          ? {
              supportedRoles: runtimeInfo.features.chat_template.supported_roles,
              preview: runtimeInfo.features.chat_template.preview,
              constraints: runtimeInfo.features.chat_template.constraints,
              toolCallFormat: runtimeInfo.features.chat_template.tool_call_format
                ? {
                    toolParserType:
                      runtimeInfo.features.chat_template.tool_call_format.tool_parser_type,
                    callStart: runtimeInfo.features.chat_template.tool_call_format.call_start,
                    callEnd: runtimeInfo.features.chat_template.tool_call_format.call_end,
                    responseStart:
                      runtimeInfo.features.chat_template.tool_call_format.response_start,
                    responseEnd: runtimeInfo.features.chat_template.tool_call_format.response_end,
                  }
                : undefined,
            }
          : undefined,
      },
      chatRestrictions: runtimeInfo.chat_restrictions
        ? {
            singleSystemAtStart: runtimeInfo.chat_restrictions.single_system_at_start,
            maxSystemMessages: runtimeInfo.chat_restrictions.max_system_messages,
            alternatingTurns: runtimeInfo.chat_restrictions.alternating_turns,
            requiresUserLast: runtimeInfo.chat_restrictions.requires_user_last,
            allowEmptyMessages: runtimeInfo.chat_restrictions.allow_empty_messages,
          }
        : undefined,
    };
  }

  override async close(): Promise<void> {
    this.logCacheStats();
    if (this.cacheDisabledForVlm) {
      await this.cacheControllerRaw?.close();
    }
    await super.close();
  }

  private logCacheStats(): void {
    if (this.cacheDisabledForVlm) return;
    if (!(this.cacheControllerRaw instanceof MlxCacheController)) return;
    const s = this.cacheControllerRaw.getStats();
    if (s.totalQueries === 0) return;

    const queryBreakdown =
      s.incremental + s.fresh > 0 ? ` (incremental ${s.incremental}, fresh ${s.fresh})` : '';
    const parts: string[] = [`cache stats: ${s.totalQueries} queries${queryBreakdown}`];
    if (s.totalPromptTokens > 0) {
      const reusedRate = ((s.prefillReusedTokens / s.totalPromptTokens) * 100).toFixed(0);
      parts.push(
        `prompt ${s.totalPromptTokens} tokens, ${s.prefillReusedTokens} reused (${reusedRate}%)`,
      );
    }
    if (s.cacheGrowthTokens > 0) {
      parts.push(`cache +${s.cacheGrowthTokens} tokens`);
    }
    this.queryLogger.log.verbose(parts.join(' | '));
  }
}
