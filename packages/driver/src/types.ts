import type { FormatterOptions } from './formatter/types.js';

// Re-export from core for convenience
export type { CompiledPrompt } from '@modular-prompt/core';

/**
 * Chat message role
 */
export type Role = 'system' | 'assistant' | 'user';

/**
 * Chat message
 */
export interface ChatMessage {
  role: Role;
  content: string;
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
 * Tool call result from the model
 */
export interface ToolCall {
  /** Unique ID for this tool call (used when returning results) */
  id: string;
  type: 'function';
  function: {
    /** Function name to call */
    name: string;
    /** Arguments as JSON string */
    arguments: string;
  };
}

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

  finishReason?: 'stop' | 'length' | 'error' | 'tool_calls';
}

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