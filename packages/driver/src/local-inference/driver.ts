import { Readable } from 'stream';
import type { CompiledPrompt } from '@modular-prompt/core';
import { extractJSON } from '@modular-prompt/utils';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import { formatCompletionPrompt } from '../formatter/completion-formatter.js';
import { extractCacheablePrefix } from '../cache-utils.js';
import { QueryLogger } from '../query-logger.js';
import type { AIDriver, FinishReason, QueryOptions, QueryResult, StreamResult } from '../types.js';
import { isToolResult } from '../types.js';
import {
  buildQueryUsage,
  createAbortedStreamResult,
  isAborted,
  watchAbortSignal,
} from '../query-utils.js';
import type {
  CapabilitiesLoadedContext,
  LocalInferenceAdapters,
  LocalInferenceCacheSupport,
} from './adapters.js';
import type { InferenceCapabilities } from './protocol.js';
import type { InferenceProcessPort } from './process-port.js';
import { createStreamIterable } from './stream-utils.js';

export interface LocalInferenceDriverConfig {
  model: string;
  process: InferenceProcessPort;
  adapters: LocalInferenceAdapters;
  formatterOptions?: FormatterOptions;
  maxImageSize?: number;
  defaultOptions?: Record<string, unknown>;
  loggerPrefix?: string;
  cache?: LocalInferenceCacheSupport;
  onCapabilitiesLoaded?: (
    runtimeInfo: InferenceCapabilities,
    ctx: CapabilitiesLoadedContext,
  ) => Promise<void>;
}

export class LocalInferenceDriver implements AIDriver {
  protected readonly process: InferenceProcessPort;
  protected readonly model: string;
  protected readonly adapters: LocalInferenceAdapters;
  protected readonly formatterOptions: FormatterOptions;
  protected readonly maxImageSize: number;
  private onCapabilitiesLoaded?: LocalInferenceDriverConfig['onCapabilitiesLoaded'];
  private cacheSupport?: LocalInferenceCacheSupport;

  protected runtimeInfo: InferenceCapabilities | null = null;
  protected modelProcessor: ReturnType<LocalInferenceAdapters['createModelProcessor']>;
  protected queryLogger: QueryLogger;
  private _defaultOptions: Record<string, unknown>;
  private capabilitiesLoaded = false;

  get defaultOptions(): Record<string, unknown> {
    return this._defaultOptions;
  }

  set defaultOptions(value: Record<string, unknown>) {
    this._defaultOptions = value ?? {};
  }

  constructor(config: LocalInferenceDriverConfig) {
    this.model = config.model;
    this.process = config.process;
    this.adapters = config.adapters;
    this._defaultOptions = config.defaultOptions ?? {};
    this.formatterOptions = config.formatterOptions ?? {};
    this.maxImageSize = config.maxImageSize ?? 768;
    this.cacheSupport = config.cache;
    this.onCapabilitiesLoaded = config.onCapabilitiesLoaded;
    this.modelProcessor = config.adapters.createModelProcessor(config.model);
    this.queryLogger = new QueryLogger(config.loggerPrefix ?? 'LIP');
  }

  protected disableCacheSupport(): void {
    this.cacheSupport = undefined;
  }

  protected async ensureInitialized(): Promise<void> {
    await this.process.ensureInitialized();

    if (this.capabilitiesLoaded) {
      return;
    }

    try {
      this.runtimeInfo = await this.process.getCapabilities();
      this.capabilitiesLoaded = true;

      if (this.runtimeInfo.special_tokens) {
        this.formatterOptions.specialTokens = this.runtimeInfo.special_tokens;
      }

      this.modelProcessor.setRuntimeContext({
        chatRestrictions: this.runtimeInfo.chat_restrictions,
        modelKind: this.runtimeInfo.model_kind,
      });

      if (this.onCapabilitiesLoaded) {
        await this.onCapabilitiesLoaded(this.runtimeInfo, {
          formatterOptions: this.formatterOptions,
          modelProcessor: this.modelProcessor,
          process: this.process,
        });
      }
    } catch (error) {
      this.queryLogger.log.error(
        'Failed to get runtime info:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  protected getRuntimeInfo(): InferenceCapabilities | null {
    return this.runtimeInfo;
  }

  protected isVLM(): boolean {
    return this.runtimeInfo?.model_kind === 'vlm';
  }

  protected determineApi(options?: QueryOptions): 'chat' | 'completion' {
    return this.adapters.selectApi(
      options?.apiStrategy || 'auto',
      options?.mode,
      !!this.runtimeInfo?.features.apply_chat_template,
      this.modelProcessor.hasCompletionProcessor(),
    );
  }

  protected hasNativeToolSupport(): boolean {
    return !!this.runtimeInfo?.features?.chat_template?.tool_call_format?.call_start;
  }

  protected async executeQuery(
    prompt: CompiledPrompt,
    samplingOptions: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ stream: Readable; cacheTokensUsed: number; cacheWriteTokens: number }> {
    const api = this.determineApi(options as QueryOptions | undefined);
    const queryOptions = options as QueryOptions | undefined;

    const tools = queryOptions?.tools
      ? this.adapters.convertToolDefinitions(queryOptions.tools)
      : undefined;

    let augmentedPrompt = prompt;
    if (
      queryOptions?.tools &&
      queryOptions.tools.length > 0 &&
      (api === 'completion' || !this.hasNativeToolSupport())
    ) {
      const toolsText = this.adapters.formatToolDefinitionsAsText(
        queryOptions.tools,
        this.runtimeInfo?.special_tokens,
        this.runtimeInfo?.features?.chat_template?.tool_call_format,
      );
      augmentedPrompt = {
        ...prompt,
        instructions: [...prompt.instructions, { type: 'text' as const, content: toolsText }],
      };
    }

    this.cacheSupport?.recordQuery();

    if (api === 'completion') {
      let formattedPrompt = formatCompletionPrompt(augmentedPrompt, this.formatterOptions);
      formattedPrompt = this.modelProcessor.applyCompletionSpecificProcessing(formattedPrompt);
      const stream = await this.process.generate(formattedPrompt, samplingOptions);
      return { stream, cacheTokensUsed: 0, cacheWriteTokens: 0 };
    }

    const messages = formatPromptAsMessages(augmentedPrompt, this.formatterOptions);
    const vlm = this.isVLM();
    let inferenceMessages = this.adapters.convertMessages(messages, vlm);
    inferenceMessages = this.modelProcessor.applyChatSpecificProcessing(inferenceMessages);
    const nativeTools = this.hasNativeToolSupport() && tools?.length ? tools : undefined;
    const images = vlm
      ? messages.flatMap((m) =>
          'content' in m && !isToolResult(m)
            ? this.adapters.extractImagePaths(m.content)
            : [],
        )
      : [];

    let cachePath: string | undefined;
    let cacheTrimTokens: number | undefined;
    let cacheWriteTokens = 0;
    const cacheGrowthBefore = this.cacheSupport?.getGrowthBefore() ?? 0;
    const trustRemoteCode = samplingOptions.trustRemoteCode;

    if (this.cacheSupport && queryOptions?.cache !== false && trustRemoteCode === undefined) {
      const prefix = extractCacheablePrefix(augmentedPrompt);
      const hasCacheableContent = prefix.instructions.length > 0 || prefix.data.length > 0;

      if (hasCacheableContent) {
        const cacheStart = performance.now();
        const handle = await this.cacheSupport.prepare({
          model: this.model,
          instructions: prefix.instructions,
          data: prefix.data,
          tools: nativeTools ? queryOptions!.tools : undefined,
          reasoningEffort: queryOptions?.reasoningEffort,
          readOnly: queryOptions?.cache === 'read-only',
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

    if (this.cacheSupport) {
      cacheWriteTokens = this.cacheSupport.getWriteTokensSince(cacheGrowthBefore);
    }

    let formattedPrompt: string;
    if (this.runtimeInfo?.features.apply_chat_template) {
      const renderResult = await this.process.render(
        inferenceMessages,
        samplingOptions,
        nativeTools,
        queryOptions?.reasoningEffort,
      );
      if (renderResult.error || renderResult.formatted_prompt == null) {
        throw new Error(renderResult.error ?? 'render failed');
      }
      formattedPrompt = String(renderResult.formatted_prompt);
    } else {
      formattedPrompt = this.adapters.generateMergedPrompt(
        inferenceMessages,
        this.runtimeInfo?.special_tokens ?? {},
      );
    }

    const generateOptions = { ...samplingOptions };
    delete generateOptions.trustRemoteCode;

    const stream = await this.process.generate(
      formattedPrompt,
      generateOptions,
      images.length > 0 ? images : undefined,
      images.length > 0 ? this.maxImageSize : undefined,
      cachePath,
      cacheTrimTokens,
    );

    const cacheTokensUsed = cachePath
      ? (cacheTrimTokens ?? (this.cacheSupport ? this.cacheSupport.readTokenCount(cachePath) : 0))
      : 0;

    return { stream, cacheTokensUsed, cacheWriteTokens };
  }

  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    const { stream, result } = await this.streamQuery(prompt, options);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of stream) {
      // Consume stream so result resolves
    }
    return result;
  }

  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
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

    const merged = this.adapters.mergeQueryOptions(
      this._defaultOptions,
      options as Record<string, unknown> | undefined,
    );
    const samplingOptions = this.adapters.toSamplingOptions(merged);
    this.queryLogger.mark(merged);

    const queryStart = performance.now();
    const { stream, cacheTokensUsed, cacheWriteTokens } = await this.executeQuery(
      prompt,
      samplingOptions,
      merged,
    );

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
            } else {
              const now = performance.now();
              if (firstChunkTime > 0) {
                const genMs = now - firstChunkTime;
                queryLogger.log.debug(
                  `generation ${genMs.toFixed(0)}ms (query total ${(now - queryStart).toFixed(0)}ms)`,
                );
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

    const cache = this.cacheSupport;
    const resultPromise = completion
      .then(({ content, meta, error }) => {
        const aborted = checkAborted();
        if (error && !aborted) {
          this.queryLogger.log.error('Stream error:', error.message);
          throw error;
        }

        if (cache && meta.prompt_tokens != null) {
          cache.recordPromptTokens(meta.prompt_tokens, cacheTokensUsed);
        }

        if (meta.generation_tokens != null && firstChunkTime > 0) {
          const genMs = performance.now() - firstChunkTime;
          const actualTps = ((meta.generation_tokens / genMs) * 1000).toFixed(1);
          this.queryLogger.log.debug(`${meta.generation_tokens} tokens, ${actualTps} tok/s`);
        }

        const hasTools = options?.tools && options.tools.length > 0;
        const responseProcessor = this.adapters.selectResponseProcessor(this.model, this.runtimeInfo, {
          enableToolParsing: !!hasTools,
        });
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

  async close(): Promise<void> {
    this.cacheSupport?.logStats();
    await this.cacheSupport?.close();
    await this.process.exit();
  }
}
