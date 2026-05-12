import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import type { MessageCreateParamsStreaming, TextBlockParam, CacheControlEphemeral } from '@anthropic-ai/sdk/resources/messages';
import type { CompiledPrompt, Element, SectionElement, SubSectionElement, MessageElement } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolCall, ToolChoice, ToolDefinition } from '../types.js';
import { extractJSON } from '@modular-prompt/utils';
import { contentToString } from '../content-utils.js';
import { QueryLogger } from '../query-logger.js';

type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControlEphemeral }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

type AnthropicMessageContent = string | AnthropicContentBlock[];

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicMessageContent;
}

type AnthropicSystem = string | TextBlockParam[];

/**
 * VertexAI経由でのClaude利用設定
 */
export interface AnthropicVertexConfig {
  /** GCPプロジェクトID */
  project: string;
  /** GCPリージョン（デフォルト: 'us-east5'） */
  location?: string;
  /** GCPアクセストークン。未指定時はADC（Application Default Credentials）から自動取得 */
  accessToken?: string;
}

/**
 * Anthropic driver configuration
 */
export interface AnthropicDriverConfig {
  apiKey?: string;
  model?: string;
  defaultOptions?: Partial<AnthropicQueryOptions>;
  /** VertexAI経由で接続する場合の設定。指定時は apiKey は不要 */
  vertex?: AnthropicVertexConfig;
}

/**
 * Anthropic-specific query options
 */
export interface AnthropicQueryOptions extends QueryOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  /** Extended Thinking configuration (requires mode: 'thinking') */
  thinking?: { budgetTokens: number };
}

/**
 * Anthropic API driver
 */
/**
 * Convert common ToolDefinition[] to Anthropic Tool format
 */
function convertTools(tools: ToolDefinition[]): MessageCreateParamsStreaming['tools'] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      ...tool.parameters
    }
  }));
}

/**
 * Convert common ToolChoice to Anthropic tool_choice format
 */
function convertToolChoice(toolChoice: ToolChoice): MessageCreateParamsStreaming['tool_choice'] {
  if (typeof toolChoice === 'string') {
    switch (toolChoice) {
      case 'auto': return { type: 'auto' };
      case 'none': return { type: 'none' };
      case 'required': return { type: 'any' };
    }
  }
  return { type: 'tool', name: toolChoice.name };
}

export class AnthropicDriver implements AIDriver {
  private client: Anthropic | AnthropicVertex;
  private defaultModel: string;
  private _defaultOptions: Partial<AnthropicQueryOptions>;
  private queryLogger = new QueryLogger('Anthropic');

  get defaultOptions(): Partial<AnthropicQueryOptions> {
    return this._defaultOptions;
  }

  set defaultOptions(value: Partial<AnthropicQueryOptions>) {
    this._defaultOptions = value;
  }

  constructor(config: AnthropicDriverConfig = {}) {
    if (config.vertex) {
      this.client = new AnthropicVertex({
        projectId: config.vertex.project,
        region: config.vertex.location || 'us-east5',
        accessToken: config.vertex.accessToken || null,
      });
    } else {
      this.client = new Anthropic({
        apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY
      });
    }

    this.defaultModel = config.model || 'claude-3-5-sonnet-20241022';
    this._defaultOptions = config.defaultOptions || {};
  }

  private static formatSectionElement(el: SectionElement<unknown> | SubSectionElement<unknown>): string {
    const parts: string[] = [];
    const prefix = el.type === 'section' ? '##' : '###';
    if (el.title) parts.push(`${prefix} ${el.title}`);
    for (const item of el.items) {
      if (typeof item === 'string') {
        parts.push(item);
      } else if (typeof item === 'object' && item !== null && 'type' in item) {
        const sub = item as SubSectionElement<unknown>;
        if (sub.type === 'subsection') {
          if (sub.title) parts.push(`### ${sub.title}`);
          parts.push(...sub.items.filter((i): i is string => typeof i === 'string'));
        }
      }
    }
    return parts.join('\n');
  }

  private pushMessageElement(el: MessageElement, messages: AnthropicMessage[], systemParts: string[]): void {
    if (el.role === 'tool') {
      let toolContent: string;
      if (el.kind === 'text') {
        toolContent = String(el.value);
      } else if (el.kind === 'data') {
        toolContent = JSON.stringify(el.value);
      } else {
        toolContent = String(el.value);
      }
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: el.toolCallId, content: toolContent, is_error: el.kind === 'error' }]
      });
    } else if (el.toolCalls && el.toolCalls.length > 0) {
      const messageContent = contentToString(el.content);
      const blocks: AnthropicContentBlock[] = [];
      if (messageContent) blocks.push({ type: 'text', text: messageContent });
      for (const tc of el.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
      }
      messages.push({ role: 'assistant', content: blocks });
    } else {
      const messageContent = contentToString(el.content);
      const role = el.role === 'system' ? 'system' : el.role === 'user' ? 'user' : 'assistant';
      if (role === 'system') {
        systemParts.push(messageContent);
      } else {
        messages.push({ role: role as 'user' | 'assistant', content: messageContent });
      }
    }
  }

  private processElements(
    elements: Element[],
    target: 'system' | 'user',
    messages: AnthropicMessage[],
    systemParts: string[]
  ): void {
    const content: string[] = [];

    const flushContent = () => {
      if (content.length > 0) {
        const text = content.join('\n');
        if (target === 'system') {
          systemParts.push(text);
        } else {
          messages.push({ role: 'user', content: text });
        }
        content.length = 0;
      }
    };

    for (const el of elements) {
      if (el.type === 'text') {
        content.push(el.content);
      } else if (el.type === 'message') {
        flushContent();
        this.pushMessageElement(el, messages, systemParts);
      } else if (el.type === 'section' || el.type === 'subsection') {
        content.push(AnthropicDriver.formatSectionElement(el));
      } else {
        content.push(JSON.stringify(el));
      }
    }
    flushContent();
  }

  private static ensureAlternation(messages: AnthropicMessage[]): void {
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: 'Continue.' });
    }
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      messages.push({ role: 'user', content: 'Continue.' });
    }
    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'Please respond according to the instructions.' });
    }
  }

  /**
   * Determine if a data element is cacheable
   */
  private static isDataElementCacheable(el: Element): boolean {
    if (el.type === 'message') return true;
    if (el.type === 'chunk') return false;
    if (el.type === 'section') {
      if (el.title === 'Current State' || el.title === 'Input Chunks') return false;
      return true;
    }
    if (el.type === 'material') return true;
    if ('cacheHint' in el) return el.cacheHint === 'static';
    return true;
  }

  compiledPromptToAnthropic(prompt: CompiledPrompt, options?: { cache?: boolean }): {
    system?: AnthropicSystem;
    messages: AnthropicMessage[];
  } {
    const cache = options?.cache ?? false;
    const systemParts: string[] = [];
    const messages: AnthropicMessage[] = [];

    // 1. instructions → system
    if (prompt.instructions?.length) {
      this.processElements(prompt.instructions, 'system', messages, systemParts);
    }

    // 2. outputSchema → JSON指示をsystemに追加（Anthropicにはformat APIがないため）
    if (prompt.metadata?.outputSchema) {
      systemParts.push('You must respond with valid JSON that matches the provided schema. Output only the JSON object, no additional text or markdown formatting.');
    }

    // 3. data処理
    let recentMessage: MessageElement | null = null;
    if (cache && prompt.data?.length) {
      const partition = AnthropicDriver.partitionDataElements(prompt.data);
      recentMessage = partition.recentMessage;
      if (partition.cacheable.length > 0) this.processElements(partition.cacheable, 'user', messages, []);
      AnthropicDriver.applyCacheBreakpoint(messages);
      if (partition.nonCacheable.length > 0) this.processElements(partition.nonCacheable, 'user', messages, []);
    } else if (prompt.data?.length) {
      this.processElements(prompt.data, 'user', messages, systemParts);
    }

    // 4. output処理
    if (cache) {
      AnthropicDriver.buildCue(prompt.output, recentMessage, messages);
    } else if (prompt.output?.length) {
      this.processElements(prompt.output, 'user', messages, systemParts);
    }

    // 5. system構築
    const system = AnthropicDriver.buildSystem(systemParts, cache);

    AnthropicDriver.ensureAlternation(messages);
    return { system, messages };
  }

  private static partitionDataElements(data: Element[]): {
    cacheable: Element[];
    nonCacheable: Element[];
    recentMessage: MessageElement | null;
  } {
    const cacheable: Element[] = [];
    const nonCacheable: Element[] = [];
    let recentMessage: MessageElement | null = null;

    for (const el of data) {
      if (AnthropicDriver.isDataElementCacheable(el)) {
        cacheable.push(el);
        if (el.type === 'message' && el.role !== 'tool') {
          recentMessage = el;
        }
      } else {
        nonCacheable.push(el);
      }
    }
    return { cacheable, nonCacheable, recentMessage };
  }

  private static applyCacheBreakpoint(messages: AnthropicMessage[]): void {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        if (typeof content === 'string') {
          messages[i].content = [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }];
        } else if (Array.isArray(content) && content.length > 0) {
          const last = content[content.length - 1];
          if (last.type === 'text') {
            content[content.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
          } else {
            content.push({ type: 'text', text: '', cache_control: { type: 'ephemeral' } });
          }
        }
        break;
      }
    }
  }

  private static buildCue(output: Element[] | undefined, recentMessage: MessageElement | null, messages: AnthropicMessage[]): void {
    const cueParts: string[] = [];
    if (output?.length) {
      for (const el of output) {
        if (el.type === 'section' || el.type === 'subsection') {
          cueParts.push(AnthropicDriver.formatSectionElement(el));
        } else if (el.type === 'text') {
          cueParts.push(el.content);
        }
      }
    }
    if (recentMessage && recentMessage.role !== 'tool') {
      cueParts.push(contentToString(recentMessage.content));
    }
    if (cueParts.length > 0) {
      messages.push({ role: 'user', content: cueParts.join('\n') });
    }
  }

  private static buildSystem(parts: string[], cache: boolean): AnthropicSystem | undefined {
    if (parts.length === 0) return undefined;
    const text = parts.join('\n\n');
    if (cache) {
      return [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } }];
    }
    return text;
  }

  /**
   * Query the AI model
   */
  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    // Use streamQuery for consistency
    const { result } = await this.streamQuery(prompt, options);
    return result;
  }

  /**
   * Stream query implementation
   */
  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
    try {
    const anthropicOptions = options as AnthropicQueryOptions || {};
    const mergedOptions = { ...this.defaultOptions, ...anthropicOptions };
    this.queryLogger.mark(mergedOptions);

    // Convert prompt
    const { system, messages } = this.compiledPromptToAnthropic(prompt, { cache: mergedOptions.cache });

    // Extended Thinking: mode === 'thinking' with thinking config
    const useThinking = mergedOptions.mode === 'thinking' && mergedOptions.thinking;

    // Build API params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: Record<string, any> = {
      model: mergedOptions.model || this.defaultModel,
      messages,
      max_tokens: mergedOptions.maxTokens || 4096,
      temperature: useThinking ? undefined : mergedOptions.temperature,
      top_p: mergedOptions.topP,
      top_k: mergedOptions.topK,
      stop_sequences: mergedOptions.stopSequences,
      system,
      tools: mergedOptions.tools ? convertTools(mergedOptions.tools) : undefined,
      tool_choice: mergedOptions.toolChoice ? convertToolChoice(mergedOptions.toolChoice) : undefined,
      stream: true,
      ...(useThinking && {
        thinking: { type: 'enabled', budget_tokens: mergedOptions.thinking!.budgetTokens }
      })
    };

    // Remove undefined values
    Object.keys(params).forEach(key => {
      if (params[key] === undefined) {
        delete params[key];
      }
    });

    // Create stream
    const anthropicStream = await this.client.messages.create(params as MessageCreateParamsStreaming);

    // Shared state
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: QueryResult['finishReason'] = 'stop';
    let streamConsumed = false;
    const chunks: string[] = [];
    const toolCallDeltas = new Map<number, { id: string; name: string; arguments: string }>();

    // Process the stream
    const processStream = async () => {
      try {
      for await (const chunk of anthropicStream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const content = chunk.delta.text;
          fullContent += content;
          chunks.push(content);
        } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
          // Register new tool call
          toolCallDeltas.set(chunk.index, {
            id: chunk.content_block.id,
            name: chunk.content_block.name,
            arguments: ''
          });
        } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
          // Accumulate tool call arguments
          const existing = toolCallDeltas.get(chunk.index);
          if (existing) {
            existing.arguments += chunk.delta.partial_json;
          }
        } else if (chunk.type === 'message_start') {
          // Get input tokens from message_start
          if (chunk.message?.usage) {
            inputTokens = chunk.message.usage.input_tokens;
          }
        } else if (chunk.type === 'message_delta') {
          // Get stop_reason and output tokens from message_delta
          if (chunk.usage) {
            outputTokens = chunk.usage.output_tokens;
          }
          if (chunk.delta?.stop_reason) {
            const reason = chunk.delta.stop_reason;
            if (reason === 'tool_use') {
              finishReason = 'tool_calls';
            } else if (reason === 'max_tokens') {
              finishReason = 'length';
            } else {
              finishReason = 'stop';
            }
          }
        }
      }
      } catch (error) {
        this.queryLogger.log.error('Stream error:', error instanceof Error ? error.message : String(error));
        finishReason = 'error';
      }
      streamConsumed = true;
    };

    // Start processing
    const processingPromise = processStream();

    // Create stream generator
    const streamGenerator = async function* () {
      let index = 0;
      while (!streamConsumed || index < chunks.length) {
        if (index < chunks.length) {
          yield chunks[index++];
        } else {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    };

    // Create result promise
    const resultPromise = processingPromise.then(() => {
      // Extract structured output if schema is provided
      let structuredOutput: unknown | undefined;
      if (prompt.metadata?.outputSchema && fullContent) {
        const extracted = extractJSON(fullContent, { multiple: false });
        if (extracted.source !== 'none' && extracted.data !== null) {
          structuredOutput = extracted.data;
        }
      }

      // Build tool calls from accumulated deltas
      let toolCalls: ToolCall[] | undefined;
      if (toolCallDeltas.size > 0) {
        toolCalls = Array.from(toolCallDeltas.values()).map(tc => {
          // Parse arguments string to object
          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(tc.arguments);
          } catch {
            // If parsing fails, use empty object
            parsedArgs = {};
          }
          return {
            id: tc.id,
            name: tc.name,
            arguments: parsedArgs
          };
        });
      }

      // Build usage
      const usage: QueryResult['usage'] | undefined =
        (inputTokens > 0 || outputTokens > 0)
          ? { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens }
          : undefined;

      return {
        content: fullContent,
        structuredOutput,
        usage,
        toolCalls,
        finishReason,
        ...this.queryLogger.collect()
      };
    });

    return {
      stream: streamGenerator(),
      result: resultPromise
    };
    } catch (error) {
      this.queryLogger.log.error('Query error:', error instanceof Error ? error.message : String(error));
      return {
        stream: (async function* () {})(),
        result: Promise.resolve({
          content: '',
          finishReason: 'error' as const,
          ...this.queryLogger.collect()
        })
      };
    }
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    // Anthropic client doesn't need explicit closing
  }
}