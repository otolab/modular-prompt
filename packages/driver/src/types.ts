import type { FormatterOptions } from './formatter/types.js';
import type { ToolCall } from '@modular-prompt/core';

// Re-export from core for convenience
export type { CompiledPrompt, ToolCall } from '@modular-prompt/core';

/**
 * Chat message role
 */
export type Role = 'system' | 'assistant' | 'user' | 'tool';

/**
 * Standard chat message (system / user / assistant without tool calls)
 */
export interface StandardChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Assistant message with tool calls
 */
export interface AssistantToolCallMessage {
  role: 'assistant';
  content: string;
  toolCalls: ToolCall[];
}

/**
 * Tool result message (response to a tool call)
 */
export interface ToolResultMessage {
  role: 'tool';
  content: string;
  /** ID of the tool call this result is for */
  toolCallId: string;
  /** Function name (required for GoogleGenAI/VertexAI) */
  name?: string;
}

/**
 * Chat message - union of all message variants
 */
export type ChatMessage = StandardChatMessage | AssistantToolCallMessage | ToolResultMessage;

/**
 * Check if a message contains tool calls
 */
export function hasToolCalls(message: ChatMessage): message is AssistantToolCallMessage {
  return message.role === 'assistant' && 'toolCalls' in message && Array.isArray((message as AssistantToolCallMessage).toolCalls);
}

/**
 * Check if a message is a tool result
 */
export function isToolResult(message: ChatMessage): message is ToolResultMessage {
  return message.role === 'tool';
}

/**
 * Tool function definition
 */
export interface ToolFunction {
  /** Function name (a-z, A-Z, 0-9, _, - up to 64 chars) */
  name: string;
  /** Description used by the model to decide when to call the tool */
  description?: string;
  /** JSON Schema object for parameters */
  parameters?: Record<string, unknown>;
  /** Strict schema adherence (OpenAI Structured Outputs) */
  strict?: boolean;
}

/**
 * Tool definition wrapper
 */
export interface ToolDefinition {
  type: 'function';
  function: ToolFunction;
}

/**
 * Tool usage strategy
 */
export type ToolChoice =
  | 'auto'      // Model decides automatically (default)
  | 'none'      // Disable tool usage
  | 'required'  // Must use at least one tool
  | { type: 'function'; function: { name: string } };  // Force specific tool


/**
 * Query result from AI model
 */
export interface QueryResult {
  /**
   * Raw text response from the model
   */
  content: string;

  /**
   * Structured output extracted from the response
   * - undefined: no schema was specified or no valid JSON found
   * - object/array: extracted JSON matching the schema
   */
  structuredOutput?: unknown;

  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** Tool calls selected by the model */
  toolCalls?: ToolCall[];

  finishReason?: FinishReason;
}

/**
 * Reason for finishing the query
 */
export type FinishReason = 'stop' | 'length' | 'error' | 'tool_calls';

/**
 * Options for querying AI model
 */
export interface QueryOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  /**
   * API selection strategy (MLX driver only)
   * - 'auto': Automatically select based on model capabilities
   * - 'force-chat': Force chat API
   * - 'force-completion': Force completion API
   */
  apiStrategy?: 'auto' | 'force-chat' | 'force-completion';
  /** Available tool definitions */
  tools?: ToolDefinition[];
  /** Tool usage strategy */
  toolChoice?: ToolChoice;
}

/**
 * Stream result with both stream and final result
 */
export interface StreamResult {
  /**
   * Async iterable stream of response chunks
   */
  stream: AsyncIterable<string>;

  /**
   * Promise that resolves to the final query result
   */
  result: Promise<QueryResult>;
}

/**
 * AI Driver interface for executing prompts
 */
export interface AIDriver {
  /**
   * Query the AI model with a compiled prompt
   */
  query(prompt: import('@modular-prompt/core').CompiledPrompt, options?: QueryOptions): Promise<QueryResult>;

  /**
   * Stream query with both stream and result
   */
  streamQuery(prompt: import('@modular-prompt/core').CompiledPrompt, options?: QueryOptions): Promise<StreamResult>;

  /**
   * Close the driver connection
   */
  close(): Promise<void>;
}

/**
 * Driver configuration
 */
export interface DriverConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'test';
  model?: string;
  apiKey?: string;
  baseURL?: string;
  defaultOptions?: QueryOptions;
}