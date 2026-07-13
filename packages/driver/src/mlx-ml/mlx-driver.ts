import { Readable } from 'stream';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, FinishReason } from '../types.js';
import { isToolResult } from '../types.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import { formatCompletionPrompt } from '../formatter/completion-formatter.js';
import { MlxProcess } from './process/index.js';
import type { MlxMlModelOptions, MlxModelCapabilities } from './types.js';
import type { MlxRuntimeInfo } from './process/types.js';
import { createModelSpecificProcessor, selectApi } from './process/model-specific.js';
import { selectResponseProcessor } from './process/model-handlers.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import { extractJSON } from '@modular-prompt/utils';
import { formatToolDefinitionsAsText } from './tool-call-parser/index.js';
import { convertMessages, convertToolDefinitions, extractImagePaths } from './mlx-message-utils.js';
import { QueryLogger } from '../query-logger.js';
import type { PromptCacheController } from '../cache-controller.js';
import { extractCacheablePrefix } from '../cache-utils.js';
import { MlxCacheController } from './mlx-cache-controller.js';
import {
  buildQueryUsage,
  createAbortedStreamResult,
  isAborted,
  watchAbortSignal,
} from '../query-utils.js';

// ========================================================================
// Utility Functions (exported for testing)
// ========================================================================

/**
 * Check if the prompt contains MessageElement
 */
export function hasMessageElement(prompt: CompiledPrompt): boolean {
  const checkElements = (elements: unknown[]): boolean => {
    if (!elements) return false;
    return elements.some(element => {
      const el = element as { type?: string };
      return el?.type === 'message';
    });
  };

  return checkElements(prompt.instructions) ||
    checkElements(prompt.data) ||
    checkElements(prompt.output);
}

// ========================================================================
// Main Class
// ========================================================================

/**
 * MLX ML driver configuration
 */
export interface MlxDriverConfig {
  model: string;
  defaultOptions?: Partial<MlxMlModelOptions>;
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
 * Creates an async iterable from a readable stream with content collection
 */
interface StreamMeta {
  prompt_tokens?: number;
  generation_tokens?: number;
}

const META_MARKER = '\x1e__META__:';

function extractStreamMeta(content: string): { content: string; meta: StreamMeta } {
  const idx = content.lastIndexOf(META_MARKER);
  if (idx === -1) return { content, meta: {} };
  const jsonStr = content.slice(idx + META_MARKER.length);
  try {
    return { content: content.slice(0, idx), meta: JSON.parse(jsonStr) };
  } catch {
    return { content: content.slice(0, idx), meta: {} };
  }
}

function createStreamIterable(
  stream: Readable,
  isAborted?: () => boolean,
): {
  iterable: AsyncIterable<string>;
  completion: Promise<{ content: string; meta: StreamMeta; error: Error | null }>;
} {
  const chunks: string[] = [];
  let resolveCompletion: (value: { content: string; meta: StreamMeta; error: Error | null }) => void;
  let settled = false;

  const settle = (error: Error | null) => {
    if (settled) return;
    settled = true;
    const raw = chunks.join('');
    const { content, meta } = extractStreamMeta(raw);
    const aborted = isAborted?.() ?? false;
    resolveCompletion({ content, meta, error: aborted ? null : error });
  };

  const completion = new Promise<{ content: string; meta: StreamMeta; error: Error | null }>((resolve) => {
    resolveCompletion = resolve;
  });

  const iterable = {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      try {
        let buffer = '';
        let markerFound = false;
        for await (const chunk of stream) {
          if (isAborted?.()) {
            break;
          }
          const str = chunk.toString();
          chunks.push(str);
          if (markerFound) continue;
          buffer += str;
          const markerIdx = buffer.indexOf(META_MARKER);
          if (markerIdx !== -1) {
            const text = buffer.slice(0, markerIdx);
            if (text) yield text;
            markerFound = true;
          } else {
            const safeLen = buffer.length - (META_MARKER.length - 1);
            if (safeLen > 0) {
              yield buffer.slice(0, safeLen);
              buffer = buffer.slice(safeLen);
            }
          }
        }
        if (!markerFound && buffer) yield buffer;
      } catch (error) {
        settle(error as Error);
        const aborted = isAborted?.() ?? false;
        if (!aborted) {
          throw error;
        }
      } finally {
        settle(null);
      }
    }
  };

  return { iterable, completion };
}

/**
 * MLX ML driver using Python subprocess
 */
export class MlxDriver implements AIDriver {
  private process: MlxProcess;
  private model: string;
  private _defaultOptions: Partial<MlxMlModelOptions>;
  private runtimeInfo: MlxRuntimeInfo | null = null;
  private modelProcessor;
  private formatterOptions: FormatterOptions;
  private maxImageSize: number;
  private queryLogger = new QueryLogger('MLX');
  private cacheController?: PromptCacheController;
  private cacheControllerBound = false;

  get defaultOptions(): Partial<MlxMlModelOptions> {
    return this._defaultOptions;
  }

  set defaultOptions(value: Partial<MlxMlModelOptions>) {
    this._defaultOptions = value;
  }

  constructor(config: MlxDriverConfig) {
    this.model = config.model;
    this._defaultOptions = config.defaultOptions || {};
    this.formatterOptions = config.formatterOptions || {};
    this.maxImageSize = config.maxImageSize ?? 768;
    this.process = new MlxProcess(config.model, {
      textOnly: config.textOnly,
      drafterModel: config.drafterModel,
      draftBlockSize: config.draftBlockSize
    });
    this.modelProcessor = createModelSpecificProcessor(config.model);
    this.cacheController = config.cacheController;
    if (config.drafterModel) {
      this.queryLogger.log.info(`Drafter model: ${config.drafterModel}`);
    }
  }

  /**
   * Initialize process and cache runtime info
   */
  private async ensureInitialized(): Promise<void> {
    // Ensure process is initialized
    await this.process.ensureInitialized();

    // Cache runtime info if not already cached
    if (!this.runtimeInfo) {
      try {
        this.runtimeInfo = await this.process.getCapabilities();

        // Update formatterOptions with special tokens from runtime info
        if (this.runtimeInfo.special_tokens) {
          this.formatterOptions.specialTokens = this.runtimeInfo.special_tokens;
        }

        // Update model processor with runtime context
        this.modelProcessor.setRuntimeContext({
          chatRestrictions: this.runtimeInfo.chat_restrictions,
          modelKind: this.runtimeInfo.model_kind,
        });

        // Bind cache controller if provided and not yet bound
        // NOTE: instanceof guard means VLM check only covers MlxCacheController.
        // A custom PromptCacheController on a VLM model would bypass this — add a
        // model-kind guard here if another implementation is introduced.
        if (this.cacheController instanceof MlxCacheController && !this.cacheControllerBound) {
          if (this.runtimeInfo.model_kind === 'vlm') {
            this.queryLogger.log.info('VLM models do not support prompt caching — cacheController disabled');
            this.cacheController = undefined;
          } else {
            await this.cacheController.bind(
              this.process,
              this.formatterOptions,
              (msgs) => this.modelProcessor.applyChatSpecificProcessing(msgs),
            );
            this.cacheControllerBound = true;
          }
        }
      } catch (error) {
        this.queryLogger.log.error('Failed to get MLX runtime info:', error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * VLMモデルかどうかを判定
   */
  private isVLM(): boolean {
    return this.runtimeInfo?.model_kind === 'vlm';
  }

  /**
   * Determine which API to use (chat or completion)
   * Simple logic based on runtime info only
   */
  private determineApi(options?: QueryOptions): 'chat' | 'completion' {
    return selectApi(
      options?.apiStrategy || 'auto',
      options?.mode,
      !!this.runtimeInfo?.features.apply_chat_template,
      this.modelProcessor.hasCompletionProcessor()
    );
  }

  /**
   * モデルがnativeツール対応かを判定
   * tool_call_format（Python側検出結果）を唯一の判断基準とする
   */
  private hasNativeToolSupport(): boolean {
    return !!this.runtimeInfo?.features?.chat_template?.tool_call_format?.call_start;
  }
  
  /**
   * Execute query and return stream
   * Common logic for query and streamQuery
   */
  private async executeQuery(
    prompt: CompiledPrompt,
    mlxOptions: MlxMlModelOptions,
    options?: QueryOptions
  ): Promise<{ stream: Readable; cacheTokensUsed: number; cacheWriteTokens: number }> {
    // APIを選択
    const api = this.determineApi(options);

    // tools変換
    const tools = options?.tools ? convertToolDefinitions(options.tools) : undefined;

    // completion API または nativeツール非対応の場合、tool定義をテキストとしてプロンプトに注入
    let augmentedPrompt = prompt;
    if (options?.tools && options.tools.length > 0 && (api === 'completion' || !this.hasNativeToolSupport())) {
      const toolsText = formatToolDefinitionsAsText(
        options.tools,
        this.runtimeInfo?.special_tokens,
        this.runtimeInfo?.features?.chat_template?.tool_call_format
      );
      augmentedPrompt = {
        ...prompt,
        instructions: [
          ...prompt.instructions,
          { type: 'text' as const, content: toolsText }
        ]
      };
    }

    // Record all queries, regardless of API mode or cache usage
    this.cacheController?.recordQuery?.();

    let stream: Readable;
    if (api === 'completion') {
      let formattedPrompt = formatCompletionPrompt(augmentedPrompt, this.formatterOptions);
      formattedPrompt = this.modelProcessor.applyCompletionSpecificProcessing(formattedPrompt);
      stream = await this.process.completion(formattedPrompt, mlxOptions);
    } else {
      const messages = formatPromptAsMessages(augmentedPrompt, this.formatterOptions);
      const vlm = this.isVLM();
      let mlxMessages = convertMessages(messages, vlm);
      mlxMessages = this.modelProcessor.applyChatSpecificProcessing(mlxMessages);
      const nativeTools = this.hasNativeToolSupport() && tools?.length ? tools : undefined;
      const images = vlm
        ? messages.flatMap(m => 'content' in m && !isToolResult(m) ? extractImagePaths(m.content) : [])
        : [];

      // Cache: chat APIのみ、以下の条件を全て満たす場合にキャッシュを使用
      // - options.cache !== false（呼び出し側が明示的に無効化していない）
      // - trustRemoteCode未指定（明示的なtrue/falseどちらもapply_chat_template kwargsに影響）
      let cachePath: string | undefined;
      let cacheTrimTokens: number | undefined;
      let cacheWriteTokens = 0;
      const cacheGrowthBefore = this.cacheController instanceof MlxCacheController
        ? this.cacheController.getStats().cacheGrowthTokens
        : 0;
      const trustRemoteCode = mlxOptions.trustRemoteCode;
      if (this.cacheController && options?.cache !== false && trustRemoteCode === undefined) {
        const prefix = extractCacheablePrefix(augmentedPrompt);
        const hasCacheableContent =
          prefix.instructions.length > 0 ||
          prefix.data.length > 0;

        if (hasCacheableContent) {
          const cacheStart = performance.now();
          const handle = await this.cacheController.prepare({
            model: this.model,
            instructions: prefix.instructions,
            data: prefix.data,
            tools: nativeTools ? options!.tools : undefined,
            reasoningEffort: options?.reasoningEffort,
            readOnly: options?.cache === 'read-only',
          });
          cachePath = handle.ref || undefined;
          cacheTrimTokens = handle.trimTokens;
          if (cachePath) {
            this.queryLogger.log.debug(
              `cache prepare ${(performance.now() - cacheStart).toFixed(0)}ms`,
              `(${prefix.instructions.length}i+${prefix.data.length}d)`,
              cacheTrimTokens != null ? `trim=${cacheTrimTokens}` : '',
            );
          }
        }
      }

      if (this.cacheController instanceof MlxCacheController) {
        cacheWriteTokens = Math.max(
          0,
          this.cacheController.getStats().cacheGrowthTokens - cacheGrowthBefore,
        );
      }

      stream = await this.process.chat(mlxMessages, undefined, mlxOptions, nativeTools, images.length > 0 ? images : undefined, images.length > 0 ? this.maxImageSize : undefined, options?.reasoningEffort, cachePath, cacheTrimTokens);

      const cacheTokensUsed = cachePath
        ? (cacheTrimTokens ?? (this.cacheController instanceof MlxCacheController
          ? this.cacheController.readCacheTokenCount(cachePath) : 0))
        : 0;
      return { stream, cacheTokensUsed, cacheWriteTokens };
    }

    return { stream, cacheTokensUsed: 0, cacheWriteTokens: 0 };
  }

  /**
   * Query the AI model with a compiled prompt
   */
  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    // Use streamQuery for consistency with other drivers
    const { stream, result } = await this.streamQuery(prompt, options);

    // Consume the stream to trigger completion
    // This is necessary because the result promise only resolves when the stream is fully consumed
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of stream) {
      // Just consume the stream, don't need to do anything with the chunks
    }

    return result;
  }
  /**
   * Stream query implementation
   */
  async streamQuery(
    prompt: CompiledPrompt,
    options?: QueryOptions
  ): Promise<StreamResult> {
    await this.ensureInitialized();

    const signal = options?.signal;
    if (isAborted(signal)) {
      return createAbortedStreamResult(this.queryLogger.collect());
    }

    let abortRequested = false;
    const cleanupAbort = watchAbortSignal(signal, () => {
      abortRequested = true;
      this.process.cancelActiveRequest();
    });
    const checkAborted = () => abortRequested || isAborted(signal);

    // Merge options (only override if explicitly provided)
    const mlxOptions: MlxMlModelOptions = {
      ...this.defaultOptions,
      ...(options?.maxTokens !== undefined && { maxTokens: options.maxTokens }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.topP !== undefined && { topP: options.topP }),
      ...(options?.topK !== undefined && { topK: options.topK }),
    };
    this.queryLogger.mark(mlxOptions as Record<string, unknown>);

    const queryStart = performance.now();
    const { stream, cacheTokensUsed, cacheWriteTokens } = await this.executeQuery(prompt, mlxOptions, options);

    if (checkAborted()) {
      this.process.cancelActiveRequest();
    }

    const streamStart = performance.now();
    this.queryLogger.log.debug(`setup ${(streamStart - queryStart).toFixed(0)}ms`);

    const { iterable, completion } = createStreamIterable(stream, checkAborted);

    const queryLogger = this.queryLogger;
    let firstChunkTime = 0;
    const wrappedIterable: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        const inner = iterable[Symbol.asyncIterator]();
        let firstChunk = true;
        return {
          async next() {
            if (checkAborted()) {
              void inner.return?.();
              return { done: true as const, value: undefined };
            }
            const result = await inner.next();
            if (!result.done) {
              if (firstChunk) {
                firstChunk = false;
                firstChunkTime = performance.now();
                queryLogger.log.debug(`TTFT ${(firstChunkTime - streamStart).toFixed(0)}ms`);
              }
            }
            if (result.done) {
              const now = performance.now();
              if (firstChunkTime > 0) {
                const genMs = now - firstChunkTime;
                queryLogger.log.debug(`generation ${genMs.toFixed(0)}ms (query total ${(now - queryStart).toFixed(0)}ms)`);
              } else {
                queryLogger.log.debug(`query total ${(performance.now() - queryStart).toFixed(0)}ms`);
              }
            }
            return result;
          },
          async return(value?: string) {
            cleanupAbort();
            return inner.return?.(value) ?? { done: true as const, value: undefined };
          },
          async throw(e?: unknown) {
            cleanupAbort();
            return inner.throw?.(e) ?? { done: true as const, value: undefined };
          },
        };
      },
    };

    const cacheController = this.cacheController;
    const resultPromise = completion
      .then(({ content, meta, error }) => {
        const aborted = checkAborted();
        if (error && !aborted) {
          this.queryLogger.log.error('Stream error:', error.message);
          throw error;
        }

        if (cacheController instanceof MlxCacheController && meta.prompt_tokens != null) {
          cacheController.recordPromptTokens(meta.prompt_tokens, cacheTokensUsed);
        }

        if (meta.generation_tokens != null && firstChunkTime > 0) {
          const genMs = performance.now() - firstChunkTime;
          const actualTps = (meta.generation_tokens / genMs * 1000).toFixed(1);
          this.queryLogger.log.debug(
            `${meta.generation_tokens} tokens, ${actualTps} tok/s`
          );
        }

        const hasTools = options?.tools && options.tools.length > 0;
        const responseProcessor = selectResponseProcessor(this.model, this.runtimeInfo, { enableToolParsing: !!hasTools });
        const parsed = responseProcessor(content);
        const finalContent = parsed.content;
        const thinkingContent = parsed.thinkingContent;
        const toolCalls = parsed.toolCalls;

        if (thinkingContent) {
          this.queryLogger.log.verbose('Thinking content:', thinkingContent);
        }

        let structuredOutput: unknown | undefined;
        if (prompt.metadata?.outputSchema && finalContent) {
          const extracted = extractJSON(finalContent, { multiple: false });
          if (extracted.source !== 'none' && extracted.data !== null) {
            structuredOutput = extracted.data;
          }
        }

        const finishReason: FinishReason = aborted
          ? 'error'
          : toolCalls
            ? 'tool_calls'
            : 'stop';

        return {
          content: finalContent,
          thinkingContent,
          structuredOutput,
          toolCalls,
          finishReason,
          usage: buildQueryUsage({
            promptTokens: meta.prompt_tokens,
            completionTokens: meta.generation_tokens,
            cacheReadTokens: cacheTokensUsed,
            cacheWriteTokens,
          }),
          ...this.queryLogger.collect(),
        };
      })
      .finally(() => {
        cleanupAbort();
      });

    return {
      stream: wrappedIterable,
      result: resultPromise,
    };
  }
  
  /**
   * Get model capabilities (public API)
   *
   * Returns runtime information converted to camelCase
   */
  async getCapabilities(): Promise<MlxModelCapabilities> {
    await this.ensureInitialized();

    if (!this.runtimeInfo) {
      throw new Error('Failed to retrieve model capabilities');
    }

    // Convert snake_case to camelCase
    return {
      methods: this.runtimeInfo.methods,
      specialTokens: this.runtimeInfo.special_tokens,
      features: {
        hasChatTemplate: this.runtimeInfo.features.apply_chat_template,
        vocabSize: this.runtimeInfo.features.vocab_size,
        modelMaxLength: this.runtimeInfo.features.model_max_length,
        chatTemplate: this.runtimeInfo.features.chat_template ? {
          supportedRoles: this.runtimeInfo.features.chat_template.supported_roles,
          preview: this.runtimeInfo.features.chat_template.preview,
          constraints: this.runtimeInfo.features.chat_template.constraints,
          toolCallFormat: this.runtimeInfo.features.chat_template.tool_call_format ? {
            toolParserType: this.runtimeInfo.features.chat_template.tool_call_format.tool_parser_type,
            callStart: this.runtimeInfo.features.chat_template.tool_call_format.call_start,
            callEnd: this.runtimeInfo.features.chat_template.tool_call_format.call_end,
            responseStart: this.runtimeInfo.features.chat_template.tool_call_format.response_start,
            responseEnd: this.runtimeInfo.features.chat_template.tool_call_format.response_end,
          } : undefined
        } : undefined
      },
      chatRestrictions: this.runtimeInfo.chat_restrictions ? {
        singleSystemAtStart: this.runtimeInfo.chat_restrictions.single_system_at_start,
        maxSystemMessages: this.runtimeInfo.chat_restrictions.max_system_messages,
        alternatingTurns: this.runtimeInfo.chat_restrictions.alternating_turns,
        requiresUserLast: this.runtimeInfo.chat_restrictions.requires_user_last,
        allowEmptyMessages: this.runtimeInfo.chat_restrictions.allow_empty_messages,
      } : undefined
    };
  }

  private logCacheStats(): void {
    if (!(this.cacheController instanceof MlxCacheController)) return;
    const s = this.cacheController.getStats();
    if (s.totalQueries === 0) return;

    const queryBreakdown = s.incremental + s.fresh > 0
      ? ` (incremental ${s.incremental}, fresh ${s.fresh})`
      : '';
    const parts: string[] = [
      `cache stats: ${s.totalQueries} queries${queryBreakdown}`,
    ];
    if (s.totalPromptTokens > 0) {
      const reusedRate = ((s.prefillReusedTokens / s.totalPromptTokens) * 100).toFixed(0);
      parts.push(`prompt ${s.totalPromptTokens} tokens, ${s.prefillReusedTokens} reused (${reusedRate}%)`);
    }
    if (s.cacheGrowthTokens > 0) {
      parts.push(`cache +${s.cacheGrowthTokens} tokens`);
    }
    this.queryLogger.log.verbose(parts.join(' | '));
  }

  /**
   * Close the process
   */
  async close(): Promise<void> {
    this.logCacheStats();
    await this.cacheController?.close();
    await this.process.exit();
  }
}