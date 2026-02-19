import OpenAI from 'openai';
import type { CompiledPrompt, Element } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolCall, ToolDefinition, ToolChoice } from '../types.js';
import type {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam
} from 'openai/resources/index.mjs';

/**
 * OpenAI driver configuration
 */
export interface OpenAIDriverConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  organization?: string;
  defaultOptions?: Partial<OpenAIQueryOptions>;
}

/**
 * OpenAI-specific query options
 */
export interface OpenAIQueryOptions extends QueryOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  n?: number;
  logprobs?: boolean;
  topLogprobs?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  seed?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
}

/**
 * OpenAI API driver
 */
export class OpenAIDriver implements AIDriver {
  private client: OpenAI;
  private defaultModel: string;
  private _defaultOptions: Partial<OpenAIQueryOptions>;

  get defaultOptions(): Partial<OpenAIQueryOptions> {
    return this._defaultOptions;
  }

  set defaultOptions(value: Partial<OpenAIQueryOptions>) {
    this._defaultOptions = value;
  }

  constructor(config: OpenAIDriverConfig = {}) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
      organization: config.organization
    });

    this.defaultModel = config.model || 'gpt-4o-mini';
    this._defaultOptions = config.defaultOptions || {};
  }

  /**
   * Convert CompiledPrompt to OpenAI messages
   */
  private compiledPromptToMessages(prompt: CompiledPrompt): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    // Helper to process elements
    const processElements = (elements: unknown[]) => {
      const content: string[] = [];

      for (const element of elements) {
        if (typeof element === 'string') {
          content.push(element);
        } else if (typeof element === 'object' && element !== null && 'type' in element) {
          const el = element as Element;

          if (el.type === 'text') {
            content.push(el.content);
          } else if (el.type === 'message') {
            // Handle message elements separately
            messages.push({
              role: el.role as 'system' | 'user' | 'assistant',
              content: typeof el.content === 'string' ? el.content : JSON.stringify(el.content)
            });
          } else if (el.type === 'section' || el.type === 'subsection') {
            // Process section content
            if (el.title) content.push(`## ${el.title}`);
            if (el.items) {
              for (const item of el.items) {
                if (typeof item === 'string') {
                  content.push(item);
                } else if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'subsection') {
                  if (item.title) content.push(`### ${item.title}`);
                  if ('items' in item && item.items) {
                    content.push(...item.items.filter((i) => typeof i === 'string'));
                  }
                }
              }
            }
          } else {
            // Default formatting for other elements
            content.push(JSON.stringify(el));
          }
        }
      }

      return content.join('\n');
    };

    // Process instructions as system message
    if (prompt.instructions && prompt.instructions.length > 0) {
      const instructionContent = processElements(prompt.instructions);
      if (instructionContent) {
        messages.push({ role: 'system', content: instructionContent });
      }
    }

    // Process data as user message
    if (prompt.data && prompt.data.length > 0) {
      const dataContent = processElements(prompt.data);
      if (dataContent) {
        messages.push({ role: 'user', content: dataContent });
      }
    }

    // Process output as user message (continuation)
    if (prompt.output && prompt.output.length > 0) {
      const outputContent = processElements(prompt.output);
      if (outputContent) {
        messages.push({ role: 'user', content: outputContent });
      }
    }

    // Ensure at least one message
    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'Please respond.' });
    }

    return messages;
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
   * Stream query implementation with both stream and result
   */
  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
    try {
      const openaiOptions = options as OpenAIQueryOptions || {};
      const mergedOptions = { ...this.defaultOptions, ...openaiOptions };
      const messages = this.compiledPromptToMessages(prompt);

      const params: ChatCompletionCreateParams = {
        model: mergedOptions.model || this.defaultModel,
        messages,
        temperature: mergedOptions.temperature,
        max_tokens: mergedOptions.maxTokens,
        top_p: mergedOptions.topP,
        frequency_penalty: mergedOptions.frequencyPenalty,
        presence_penalty: mergedOptions.presencePenalty,
        stop: mergedOptions.stop,
        response_format: prompt.metadata?.outputSchema ? { type: 'json_object' } : undefined,
        tools: mergedOptions.tools as ChatCompletionCreateParams['tools'],
        tool_choice: mergedOptions.toolChoice as ChatCompletionCreateParams['tool_choice'],
        stream: true
      };

      // Remove undefined values
      Object.keys(params).forEach(key => {
        if (params[key as keyof typeof params] === undefined) {
          delete params[key as keyof typeof params];
        }
      });

      const openaiStream = await this.client.chat.completions.create(params);

      // Shared state for accumulating content and metadata
      let fullContent = '';
      let usage: QueryResult['usage'] | undefined;
      let finishReason: QueryResult['finishReason'] = 'stop';
      let streamConsumed = false;
      const chunks: string[] = [];
      const toolCallDeltas = new Map<number, { id: string; name: string; arguments: string }>();

      // Process the OpenAI stream and cache chunks
      const processStream = async () => {
        try {
          for await (const chunk of openaiStream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              fullContent += content;
              chunks.push(content);
            }

            // Accumulate tool call deltas
            const deltaToolCalls = chunk.choices[0]?.delta?.tool_calls;
            if (deltaToolCalls) {
              for (const delta of deltaToolCalls) {
                const existing = toolCallDeltas.get(delta.index);
                if (existing) {
                  // Append arguments fragment
                  if (delta.function?.arguments) {
                    existing.arguments += delta.function.arguments;
                  }
                } else {
                  // New tool call
                  toolCallDeltas.set(delta.index, {
                    id: delta.id || '',
                    name: delta.function?.name || '',
                    arguments: delta.function?.arguments || ''
                  });
                }
              }
            }

            // Update finish reason if provided
            if (chunk.choices[0]?.finish_reason) {
              const reason = chunk.choices[0].finish_reason;
              if (reason === 'tool_calls') {
                finishReason = 'tool_calls';
              } else if (reason === 'length') {
                finishReason = 'length';
              } else if (reason === 'content_filter') {
                finishReason = 'error';
              }
            }

            // Accumulate usage if provided (usually in the final chunk)
            if (chunk.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens
              };
            }
          }
        } catch {
          finishReason = 'error';
        }
        streamConsumed = true;
      };

      // Start processing the stream
      const processingPromise = processStream();

      // Create the stream generator that yields cached chunks
      const streamGenerator = async function* () {
        let index = 0;
        while (!streamConsumed || index < chunks.length) {
          if (index < chunks.length) {
            yield chunks[index++];
          } else {
            // Wait a bit for more chunks
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      };

      // Create result promise
      const resultPromise = processingPromise.then(() => {
        // If response_format was used, the content should already be JSON
        let structuredOutput: unknown | undefined;
        if (prompt.metadata?.outputSchema && params.response_format?.type === 'json_object') {
          try {
            structuredOutput = JSON.parse(fullContent);
          } catch {
            // Keep as undefined if parsing fails
          }
        }

        // Build tool calls from accumulated deltas
        let toolCalls: ToolCall[] | undefined;
        if (toolCallDeltas.size > 0) {
          toolCalls = Array.from(toolCallDeltas.values()).map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }));
        }

        return {
          content: fullContent,
          structuredOutput,
          usage,
          toolCalls,
          finishReason
        };
      });

      return {
        stream: streamGenerator(),
        result: resultPromise
      };
    } catch {
      // Return error state
      return {
        stream: (async function* () {
          // Empty stream
        })(),
        result: Promise.resolve({
          content: '',
          finishReason: 'error' as const
        })
      };
    }
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    // OpenAI client doesn't need explicit closing
  }
}