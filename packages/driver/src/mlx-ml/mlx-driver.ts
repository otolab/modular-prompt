import { Readable } from 'stream';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolDefinition, ToolCall, FinishReason } from '../types.js';
import { hasToolCalls, isToolResult } from '../types.js';
import type { FormatterOptions, ChatMessage } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import { formatCompletionPrompt } from '../formatter/completion-formatter.js';
import { MlxProcess } from './process/index.js';
import type { MlxMessage, MlxMlModelOptions, MlxModelCapabilities, MlxContentPart } from './types.js';
import type { MlxRuntimeInfo, MlxToolDefinition } from './process/types.js';
import { createModelSpecificProcessor, selectApi } from './process/model-specific.js';
import { selectResponseProcessor } from './process/model-handlers.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import { extractJSON } from '@modular-prompt/utils';
import { parseToolCalls, formatToolDefinitionsAsText } from './tool-call-parser.js';
import { contentToString, extractImagePaths } from '../content-utils.js';
import { QueryLogger } from '../query-logger.js';

// ========================================================================
// Utility Functions (exported for testing)
// ========================================================================

/**
 * Convert ToolDefinition to MlxToolDefinition
 */
function convertToolDefinitions(tools: ToolDefinition[]): MlxToolDefinition[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

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

/**
 * Convert ChatMessage format to MLX format
 * VLM mode preserves image placeholders as structured content parts
 */
export function convertMessages(messages: ChatMessage[], vlm: boolean = false): MlxMessage[] {
  return messages.map(msg => {
    // AssistantToolCallMessage - tool_calls付きメッセージ
    if (hasToolCalls(msg)) {
      return {
        role: 'assistant' as const,
        content: msg.content,
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }))
      };
    }

    // ToolResultMessage - ツール結果メッセージ
    if (isToolResult(msg)) {
      let content: string;
      if (msg.kind === 'text') {
        content = String(msg.value);
      } else if (msg.kind === 'data') {
        content = JSON.stringify(msg.value);
      } else {
        content = String(msg.value);
      }
      return {
        role: 'tool' as const,
        content,
        tool_call_id: msg.toolCallId,
        name: msg.name
      };
    }

    // StandardChatMessage - 通常メッセージ（VLM対応含む）
    if (vlm && Array.isArray(msg.content)) {
      const parts: MlxContentPart[] = [];
      for (const att of msg.content) {
        if (att.type === 'image_url' && att.image_url?.url) {
          parts.push({ type: 'image' });
        } else if (att.type === 'text' && att.text) {
          parts.push({ type: 'text', text: att.text });
        }
      }
      if (parts.length > 0) {
        return { role: msg.role as 'system' | 'user' | 'assistant', content: parts };
      }
    }
    return {
      role: msg.role as 'system' | 'user' | 'assistant',
      content: contentToString(msg.content)
    };
  });
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
}

/**
 * Creates an async iterable from a readable stream with content collection
 */
function createStreamIterable(stream: Readable): {
  iterable: AsyncIterable<string>;
  completion: Promise<{ content: string; error: Error | null }>;
} {
  const chunks: string[] = [];
  let resolveCompletion: (value: { content: string; error: Error | null }) => void;

  const completion = new Promise<{ content: string; error: Error | null }>((resolve) => {
    resolveCompletion = resolve;
  });

  // Create async iterable that collects chunks and handles completion
  const iterable = {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      try {
        for await (const chunk of stream) {
          const str = chunk.toString();
          chunks.push(str);
          yield str;
        }
        // Stream ended successfully
        resolveCompletion({ content: chunks.join(''), error: null });
      } catch (error) {
        // Stream errored
        resolveCompletion({ content: chunks.join(''), error: error as Error });
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
    this.process = new MlxProcess(config.model, { textOnly: config.textOnly });
    this.modelProcessor = createModelSpecificProcessor(config.model);
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
  ): Promise<Readable> {
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
      // instructions の末尾にTextElementとして追加
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
      // completion APIを使用 - 標準フォーマッターを使用
      // completion APIではtools非対応
      let formattedPrompt = formatCompletionPrompt(augmentedPrompt, this.formatterOptions);
      // モデル固有の後処理を適用
      formattedPrompt = this.modelProcessor.applyCompletionSpecificProcessing(formattedPrompt);
      stream = await this.process.completion(formattedPrompt, mlxOptions);
    } else {
      // chat APIを使用 - メッセージ変換して処理
      const messages = formatPromptAsMessages(augmentedPrompt, this.formatterOptions);
      const vlm = this.isVLM();
      let mlxMessages = convertMessages(messages, vlm);
      // chat APIではチャット処理を適用
      mlxMessages = this.modelProcessor.applyChatSpecificProcessing(mlxMessages);
      // nativeツール対応の場合のみPythonにtoolsを渡す
      const nativeTools = this.hasNativeToolSupport() ? tools : undefined;
      // VLMの場合は画像パスを抽出（ファイル読み込み用）
      const images = vlm
        ? messages.flatMap(m => 'content' in m && !isToolResult(m) ? extractImagePaths(m.content) : [])
        : [];
      stream = await this.process.chat(mlxMessages, undefined, mlxOptions, nativeTools, images.length > 0 ? images : undefined, images.length > 0 ? this.maxImageSize : undefined, options?.reasoningEffort);
    }

    return stream;
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
    const stream = await this.executeQuery(prompt, mlxOptions, options);

    // Convert stream to async iterable with collection
    const { iterable, completion } = createStreamIterable(stream);

    // Create result promise that waits for stream completion
    const resultPromise = completion.then(({ content, error }) => {
      // If there was an error, log and throw it
      if (error) {
        this.queryLogger.log.error('Stream error:', error.message);
        throw error;
      }

      // Response post-processing via model-specific processor
      const responseProcessor = selectResponseProcessor(this.model, this.runtimeInfo);
      let finalContent = content;
      let thinkingContent: string | undefined;
      let toolCalls: ToolCall[] | undefined;

      if (responseProcessor) {
        const parsed = responseProcessor(content);
        finalContent = parsed.content;
        thinkingContent = parsed.thinkingContent;
        toolCalls = parsed.toolCalls;
      } else {
        // Legacy flow: tool call detection only
        if (options?.tools && options.tools.length > 0) {
          const parseResult = parseToolCalls(content, this.runtimeInfo);
          if (parseResult.toolCalls.length > 0) {
            toolCalls = parseResult.toolCalls;
            finalContent = parseResult.content;
          }
        }
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
      stream: iterable,
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

  /**
   * Close the process
   */
  async close(): Promise<void> {
    await this.process.exit();
  }
}