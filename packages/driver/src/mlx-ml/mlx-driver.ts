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
import { formatToolDefinitionsAsText } from './tool-call-parser.js';
import { convertMessages, convertToolDefinitions, extractImagePaths } from './mlx-message-utils.js';
import { QueryLogger } from '../query-logger.js';
import type { PromptCacheController } from '../cache-controller.js';
import { extractCacheablePrefix } from '../cache-utils.js';
import { MlxCacheController } from './mlx-cache-controller.js';

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

const META_MARKER = '\n__META__:';

function extractStreamMeta(content: string): { content: string; meta: StreamMeta } {
  const idx = content.lastIndexOf(META_MARKER);
  if (idx === -1) return { content, meta: {} };
  const jsonStr = content.slice(idx + META_MARKER.length);
  try {
    return { content: content.slice(0, idx), meta: JSON.parse(jsonStr) };
  } catch {
    return { content, meta: {} };
  }
}

function createStreamIterable(stream: Readable): {
  iterable: AsyncIterable<string>;
  completion: Promise<{ content: string; meta: StreamMeta; error: Error | null }>;
} {
  const chunks: string[] = [];
  let resolveCompletion: (value: { content: string; meta: StreamMeta; error: Error | null }) => void;

  const completion = new Promise<{ content: string; meta: StreamMeta; error: Error | null }>((resolve) => {
    resolveCompletion = resolve;
  });

  const iterable = {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      try {
        const pending: string[] = [];
        for await (const chunk of stream) {
          const str = chunk.toString();
          chunks.push(str);
          pending.push(str);
          while (pending.length > 2) {
            yield pending.shift()!;
          }
        }
        const tail = pending.join('');
        const metaIdx = tail.lastIndexOf(META_MARKER);
        if (metaIdx !== -1) {
          const text = tail.slice(0, metaIdx);
          if (text) yield text;
        } else {
          if (tail) yield tail;
        }
        const raw = chunks.join('');
        const { content, meta } = extractStreamMeta(raw);
        resolveCompletion({ content, meta, error: null });
      } catch (error) {
        const raw = chunks.join('');
        const { content, meta } = extractStreamMeta(raw);
        resolveCompletion({ content, meta, error: error as Error });
        throw error;
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
    this.process = new MlxProcess(config.model, { textOnly: config.textOnly, drafterModel: config.drafterModel });
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
            this.cacheController.bind(
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
  ): Promise<{ stream: Readable; cacheTokensUsed: number }> {
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

      this.cacheController?.recordQuery();
      const images = vlm
        ? messages.flatMap(m => 'content' in m && !isToolResult(m) ? extractImagePaths(m.content) : [])
        : [];

      // Cache: chat APIのみ、以下の条件を全て満たす場合にキャッシュを使用
      // - outputSchema未指定（formatPromptAsMessagesがschemaを挿入し、prefixがずれる）
      // - trustRemoteCode未指定（明示的なtrue/falseどちらもapply_chat_template kwargsに影響）
      let cachePath: string | undefined;
      let cacheTrimTokens: number | undefined;
      const trustRemoteCode = mlxOptions.trustRemoteCode;
      if (this.cacheController && !augmentedPrompt.metadata?.outputSchema && trustRemoteCode === undefined) {
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

      stream = await this.process.chat(mlxMessages, undefined, mlxOptions, nativeTools, images.length > 0 ? images : undefined, images.length > 0 ? this.maxImageSize : undefined, options?.reasoningEffort, cachePath, cacheTrimTokens);

      const cacheTokensUsed = cachePath
        ? (cacheTrimTokens ?? (this.cacheController instanceof MlxCacheController
          ? this.cacheController.readCacheTokenCount(cachePath) : 0))
        : 0;
      return { stream, cacheTokensUsed };
    }

    return { stream, cacheTokensUsed: 0 };
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

    // Merge options (only override if explicitly provided)
    const mlxOptions: MlxMlModelOptions = {
      ...this.defaultOptions,
      ...(options?.maxTokens !== undefined && { maxTokens: options.maxTokens }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.topP !== undefined && { topP: options.topP }),
      ...(options?.topK !== undefined && { topK: options.topK }),
    };
    this.queryLogger.mark(mlxOptions as Record<string, unknown>);

    // Use executeQuery for the actual stream generation
    const queryStart = performance.now();
    const { stream, cacheTokensUsed } = await this.executeQuery(prompt, mlxOptions, options);
    const streamStart = performance.now();
    this.queryLogger.log.debug(`setup ${(streamStart - queryStart).toFixed(0)}ms`);

    // Convert stream to async iterable with collection
    const { iterable, completion } = createStreamIterable(stream);

    // Wrap iterable with phase-separated timing:
    //   TTFT: streamStart → first chunk (inference latency, shows cache benefit)
    //   generation: first chunk → last chunk (output speed, tok/s)
    //   query total: queryStart → last chunk (end-to-end)
    const queryLogger = this.queryLogger;
    const wrappedIterable: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        const inner = iterable[Symbol.asyncIterator]();
        let firstChunk = true;
        let firstChunkTime = 0;
        let chunkCount = 0;
        return {
          async next() {
            const result = await inner.next();
            if (!result.done) {
              chunkCount++;
              if (firstChunk) {
                firstChunk = false;
                firstChunkTime = performance.now();
                queryLogger.log.debug(`TTFT ${(firstChunkTime - streamStart).toFixed(0)}ms`);
              }
            }
            if (result.done) {
              const now = performance.now();
              if (firstChunkTime > 0 && chunkCount > 1) {
                const genMs = now - firstChunkTime;
                const tps = ((chunkCount - 1) / genMs * 1000).toFixed(1);
                queryLogger.log.debug(`generation ${genMs.toFixed(0)}ms ~${chunkCount} tok ${tps} tok/s (query total ${(now - queryStart).toFixed(0)}ms)`);
              } else {
                queryLogger.log.debug(`query total ${(performance.now() - queryStart).toFixed(0)}ms`);
              }
            }
            return result;
          },
        };
      },
    };

    // Create result promise that waits for stream completion
    const cacheController = this.cacheController;
    const resultPromise = completion.then(({ content, meta, error }) => {
      // If there was an error, log and throw it
      if (error) {
        this.queryLogger.log.error('Stream error:', error.message);
        throw error;
      }

      if (cacheController instanceof MlxCacheController && meta.prompt_tokens) {
        cacheController.recordPromptTokens(meta.prompt_tokens, cacheTokensUsed);
      }

      // Response post-processing: thinking抽出 + tool call解析
      const hasTools = options?.tools && options.tools.length > 0;
      const responseProcessor = selectResponseProcessor(this.model, this.runtimeInfo, { enableToolParsing: !!hasTools });
      const parsed = responseProcessor(content);
      let finalContent = parsed.content;
      const thinkingContent = parsed.thinkingContent;
      const toolCalls = parsed.toolCalls;

      if (thinkingContent) {
        this.queryLogger.log.verbose('Thinking content:', thinkingContent);
      }

      // Handle structured output if schema is provided
      let structuredOutput: unknown | undefined;
      if (prompt.metadata?.outputSchema && finalContent) {
        const extracted = extractJSON(finalContent, { multiple: false });
        if (extracted.source !== 'none' && extracted.data !== null) {
          structuredOutput = extracted.data;
        }
      }

      const finishReason: FinishReason = toolCalls ? 'tool_calls' : 'stop';
      return {
        content: finalContent,
        thinkingContent,
        structuredOutput,
        toolCalls,
        finishReason,
        ...this.queryLogger.collect()
      };
    });

    return {
      stream: wrappedIterable,
      result: resultPromise
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
    if (s.totalQueries === 0 && s.cached === 0) return;

    const cacheRate = s.totalQueries > 0 ? ((s.cached / s.totalQueries) * 100).toFixed(0) : '0';
    const hitRate = s.cached > 0 ? (((s.memoryHit + s.diskHit) / s.cached) * 100).toFixed(0) : '0';
    const parts: string[] = [
      `cache stats: ${s.totalQueries} queries, ${s.cached} cached (${cacheRate}%)`,
    ];
    if (s.cached > 0) {
      parts.push(`hit ${hitRate}%`);
    }
    if (s.totalPromptTokens > 0) {
      const reuse = ((s.totalCacheTokensUsed / s.totalPromptTokens) * 100).toFixed(0);
      parts.push(`${s.totalCacheTokensUsed}/${s.totalPromptTokens} prompt tokens from cache (${reuse}%)`);
    }
    if (s.prefillTokens > 0) {
      const reusedRate = ((s.prefillReusedTokens / s.prefillTokens) * 100).toFixed(0);
      parts.push(`prefill ${s.prefillTokens} tokens, ${s.prefillReusedTokens} reused (${reusedRate}%)`);
    }
    parts.push(`(memory=${s.memoryHit} disk=${s.diskHit} incremental=${s.incremental} fresh=${s.fresh})`);
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