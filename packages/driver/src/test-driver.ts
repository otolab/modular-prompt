import type { CompiledPrompt, ToolCall } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, FinishReason } from './types.js';
import { extractJSON } from '@modular-prompt/utils';

/**
 * Mock response configuration
 */
export interface MockResponse {
  content: string;
  finishReason?: FinishReason;
  toolCalls?: ToolCall[];
}

/**
 * Response provider function type
 * A function that generates responses dynamically based on the prompt and options.
 * Called each time query() or streamQuery() is invoked.
 *
 * @param prompt - The compiled prompt being executed
 * @param options - Query options (temperature, maxTokens, etc.)
 * @returns The response string or MockResponse object
 */
export type ResponseProvider = (prompt: CompiledPrompt, options?: QueryOptions) => string | MockResponse | Promise<string | MockResponse>;

/**
 * Test driver options
 */
export interface TestDriverOptions {
  /**
   * Mock responses for the driver.
   * Can be either:
   * - An array of strings: responses are consumed sequentially (queue pattern)
   * - An array of MockResponse objects: responses with finishReason control
   * - A function: called for each query to generate dynamic responses
   */
  responses?: (string | MockResponse)[] | ResponseProvider;

  /**
   * Delay in milliseconds to simulate API latency.
   * Applied before returning each response.
   */
  delay?: number;
}

/**
 * Simple token estimation (roughly 4 characters per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Test driver for unit testing and mocking AI responses.
 *
 * @example
 * // Using response queue (array)
 * const driver = new TestDriver({
 *   responses: ['First', 'Second', 'Third']
 * });
 * await driver.query(prompt); // Returns 'First'
 * await driver.query(prompt); // Returns 'Second'
 * await driver.query(prompt); // Returns 'Third'
 * await driver.query(prompt); // Throws: No more responses available
 *
 * @example
 * // Using response provider (function)
 * const driver = new TestDriver({
 *   responses: (prompt, options) => {
 *     if (prompt.metadata?.outputSchema) {
 *       return JSON.stringify({ result: 'structured' });
 *     }
 *     return 'Plain text';
 *   }
 * });
 */
export class TestDriver implements AIDriver {
  /** Queue of responses when using array mode */
  private responseQueue: MockResponse[];
  /** Function to generate responses dynamically */
  private responseProvider?: ResponseProvider;
  /** Delay in milliseconds to simulate latency */
  private delay: number;

  constructor(options: TestDriverOptions = {}) {
    if (typeof options.responses === 'function') {
      // Function mode: generate responses dynamically
      this.responseProvider = options.responses;
      this.responseQueue = [];
    } else {
      // Array mode: use responses as a queue (FIFO)
      // Normalize string responses to MockResponse objects
      this.responseQueue = options.responses
        ? options.responses.map(r => typeof r === 'string' ? { content: r, finishReason: 'stop' as const } : r)
        : [];
      this.responseProvider = undefined;
    }
    this.delay = options.delay || 0;
  }
  
  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    // Create a simple formatted prompt for token counting
    const formattedPrompt = [
      prompt.instructions,
      prompt.data,
      prompt.output
    ].filter(Boolean).join('\n\n');

    // If we have a response provider function, use it
    if (this.responseProvider) {
      // Dynamic response generation mode
      const response = await this.responseProvider(prompt, options);

      // Normalize response to MockResponse
      const mockResponse: MockResponse = typeof response === 'string'
        ? { content: response, finishReason: 'stop' }
        : response;

      // Simulate API latency if configured
      if (this.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delay));
      }

      // Handle structured outputs if schema is provided
      // This attempts to extract JSON from the response if outputSchema is defined
      let structuredOutput: unknown | undefined;
      if (prompt.metadata?.outputSchema && mockResponse.content) {
        const extracted = extractJSON(mockResponse.content, { multiple: false });
        if (extracted.source !== 'none' && extracted.data !== null) {
          structuredOutput = extracted.data;
        }
      }

      return {
        content: mockResponse.content,
        structuredOutput,
        toolCalls: mockResponse.toolCalls,
        usage: {
          promptTokens: estimateTokens(formattedPrompt),
          completionTokens: estimateTokens(mockResponse.content),
          totalTokens: estimateTokens(formattedPrompt) + estimateTokens(mockResponse.content)
        },
        finishReason: mockResponse.finishReason || (mockResponse.toolCalls?.length ? 'tool_calls' : 'stop')
      };
    }

    // Queue mode: consume responses sequentially
    if (this.responseQueue.length === 0) {
      throw new Error('No more responses available');
    }

    // Simulate API latency if configured
    if (this.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delay));
    }

    // Take the first response from the queue (FIFO pattern)
    const mockResponse = this.responseQueue.shift()!;

    // Handle structured outputs if schema is provided
    // This attempts to extract JSON from the response if outputSchema is defined
    let structuredOutput: unknown | undefined;
    if (prompt.metadata?.outputSchema && mockResponse.content) {
      const extracted = extractJSON(mockResponse.content, { multiple: false });
      if (extracted.source !== 'none' && extracted.data !== null) {
        structuredOutput = extracted.data;
      }
    }

    return {
      content: mockResponse.content,
      structuredOutput,
      toolCalls: mockResponse.toolCalls,
      usage: {
        promptTokens: estimateTokens(formattedPrompt),
        completionTokens: estimateTokens(mockResponse.content),
        totalTokens: estimateTokens(formattedPrompt) + estimateTokens(mockResponse.content)
      },
      finishReason: mockResponse.finishReason || (mockResponse.toolCalls?.length ? 'tool_calls' : 'stop')
    };
  }


  /**
   * Stream a response character by character.
   * Consumes one response from the queue or calls the provider function.
   */
  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
    // Create a simple formatted prompt for token counting
    const formattedPrompt = [
      prompt.instructions,
      prompt.data,
      prompt.output
    ].filter(Boolean).join('\n\n');

    // Get the response (either from provider function or queue)
    let mockResponse: MockResponse;
    if (this.responseProvider) {
      // Dynamic mode: generate response
      const response = await this.responseProvider(prompt, options);
      mockResponse = typeof response === 'string'
        ? { content: response, finishReason: 'stop' }
        : response;
    } else {
      // Queue mode: consume one response
      if (this.responseQueue.length === 0) {
        throw new Error('No more responses available');
      }
      mockResponse = this.responseQueue.shift()!;
    }

    // Create stream generator that yields characters one by one
    const delay = this.delay;
    const content = mockResponse.content;
    async function* streamGenerator(): AsyncIterable<string> {
      // Stream response character by character to simulate streaming
      for (const char of content) {
        if (delay > 0) {
          // Distribute delay across all characters
          await new Promise(resolve => setTimeout(resolve, delay / content.length));
        }
        yield char;
      }
    }

    // Handle structured outputs if schema is provided
    // Extract JSON from the complete response (not streamed)
    let structuredOutput: unknown | undefined;
    if (prompt.metadata?.outputSchema && mockResponse.content) {
      const extracted = extractJSON(mockResponse.content, { multiple: false });
      if (extracted.source !== 'none' && extracted.data !== null) {
        structuredOutput = extracted.data;
      }
    }

    // Create result promise
    const resultPromise = Promise.resolve({
      content: mockResponse.content,
      structuredOutput,
      toolCalls: mockResponse.toolCalls,
      usage: {
        promptTokens: estimateTokens(formattedPrompt),
        completionTokens: estimateTokens(mockResponse.content),
        totalTokens: estimateTokens(formattedPrompt) + estimateTokens(mockResponse.content)
      },
      finishReason: mockResponse.finishReason || (mockResponse.toolCalls?.length ? 'tool_calls' : 'stop')
    });

    return {
      stream: streamGenerator(),
      result: resultPromise
    };
  }
  
  async close(): Promise<void> {
    // No resources to clean up
  }
}