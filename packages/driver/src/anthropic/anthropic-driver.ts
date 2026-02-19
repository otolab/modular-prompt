import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { CompiledPrompt, Element } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolCall, ToolChoice, ToolDefinition, ChatMessage } from '../types.js';
import { extractJSON } from '@modular-prompt/utils';
import { hasToolCalls, isToolResult } from '../types.js';

/**
 * Anthropic driver configuration
 */
export interface AnthropicDriverConfig {
  apiKey?: string;
  model?: string;
  defaultOptions?: Partial<AnthropicQueryOptions>;
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
}

/**
 * Anthropic API driver
 */
/**
 * Convert common ToolDefinition[] to Anthropic Tool format
 */
function convertTools(tools: ToolDefinition[]): MessageCreateParamsStreaming['tools'] {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: {
      type: 'object' as const,
      ...tool.function.parameters
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
  return { type: 'tool', name: toolChoice.function.name };
}

export class AnthropicDriver implements AIDriver {
  private client: Anthropic;
  private defaultModel: string;
  private _defaultOptions: Partial<AnthropicQueryOptions>;

  get defaultOptions(): Partial<AnthropicQueryOptions> {
    return this._defaultOptions;
  }

  set defaultOptions(value: Partial<AnthropicQueryOptions>) {
    this._defaultOptions = value;
  }

  constructor(config: AnthropicDriverConfig = {}) {
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY
    });

    this.defaultModel = config.model || 'claude-3-5-sonnet-20241022';
    this._defaultOptions = config.defaultOptions || {};
  }

  /**
   * Convert ChatMessage to Anthropic message format
   */
  private chatMessageToAnthropic(message: ChatMessage): { role: 'user' | 'assistant'; content: unknown } {
    if (hasToolCalls(message)) {
      // AssistantToolCallMessage
      const blocks: unknown[] = [];
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const tc of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments)
        });
      }
      return { role: 'assistant', content: blocks };
    } else if (isToolResult(message)) {
      // ToolResultMessage
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content
        }]
      };
    } else {
      // StandardChatMessage (system role is not expected in options.messages)
      return {
        role: message.role as 'user' | 'assistant',
        content: message.content
      };
    }
  }

  /**
   * Convert CompiledPrompt to Anthropic messages
   */
  private compiledPromptToAnthropic(prompt: CompiledPrompt): {
    system?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  } {
    let system: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    // Helper to process elements
    const processElements = (elements: unknown[]): string => {
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
            const messageContent = typeof el.content === 'string' ? el.content : JSON.stringify(el.content);

            if (el.role === 'tool') {
              messages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: el.toolCallId, content: el.content }]
              });
            } else if ('toolCalls' in el && el.toolCalls) {
              const blocks: unknown[] = [];
              if (messageContent) blocks.push({ type: 'text', text: messageContent });
              for (const tc of el.toolCalls) {
                blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
              }
              messages.push({ role: 'assistant', content: blocks });
            } else {
              const role = el.role === 'system' ? 'system' : el.role === 'user' ? 'user' : 'assistant';
              if (role === 'system') {
                system = system ? `${system}\n\n${messageContent}` : messageContent;
              } else {
                messages.push({ role: role as 'user' | 'assistant', content: messageContent });
              }
            }
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
        system = system ? `${system}\n\n${instructionContent}` : instructionContent;
      }
    }

    // Add JSON instruction if schema is provided
    if (prompt.metadata?.outputSchema) {
      const jsonInstruction = '\n\nYou must respond with valid JSON that matches the provided schema. Output only the JSON object, no additional text or markdown formatting.';
      system = system ? `${system}${jsonInstruction}` : jsonInstruction;
    }

    // Process data as user message
    if (prompt.data && prompt.data.length > 0) {
      const dataContent = processElements(prompt.data);
      if (dataContent) {
        messages.push({ role: 'user', content: dataContent });
      }
    }

    // Process output as user message
    if (prompt.output && prompt.output.length > 0) {
      const outputContent = processElements(prompt.output);
      if (outputContent) {
        messages.push({ role: 'user', content: outputContent });
      }
    }

    // Ensure messages alternate between user and assistant
    // If first message is not user, add a dummy user message
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: 'Continue.' });
    }

    // If last message is assistant, add a dummy user message
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      messages.push({ role: 'user', content: 'Continue.' });
    }

    // If no messages, add a default
    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'Please respond according to the instructions.' });
    }

    return { system, messages };
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
    const anthropicOptions = options as AnthropicQueryOptions || {};
    const mergedOptions = { ...this.defaultOptions, ...anthropicOptions };

    // Convert prompt
    const { system, messages } = this.compiledPromptToAnthropic(prompt);

    // Build API params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: Record<string, any> = {
      model: mergedOptions.model || this.defaultModel,
      messages,
      max_tokens: mergedOptions.maxTokens || 4096,
      temperature: mergedOptions.temperature,
      top_p: mergedOptions.topP,
      top_k: mergedOptions.topK,
      stop_sequences: mergedOptions.stopSequences,
      system,
      tools: mergedOptions.tools ? convertTools(mergedOptions.tools) : undefined,
      tool_choice: mergedOptions.toolChoice ? convertToolChoice(mergedOptions.toolChoice) : undefined,
      stream: true
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
        toolCalls = Array.from(toolCallDeltas.values()).map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments
          }
        }));
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
        finishReason
      };
    });

    return {
      stream: streamGenerator(),
      result: resultPromise
    };
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    // Anthropic client doesn't need explicit closing
  }
}