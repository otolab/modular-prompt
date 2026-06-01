import type { CompiledPrompt } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult } from './types.js';
import type { FormatterOptions } from './formatter/types.js';
import { formatCompletionPrompt, formatPromptAsMessages, ECHO_SPECIAL_TOKENS } from './formatter/converter.js';
import { extractJSON } from '@modular-prompt/utils';

/**
 * Echo driver configuration
 */
export interface EchoDriverConfig {
  /**
   * Format for echo output determines what the driver returns:
   * - 'text': Human-readable markdown formatted text
   * - 'messages': Array of chat messages as JSON (for testing message-based APIs)
   * - 'raw': The raw CompiledPrompt object as JSON (includes metadata)
   * - 'both': Object containing both 'text' and 'messages' fields as JSON
   * - 'debug': Comprehensive debug info including raw prompt, formatted versions, and metadata
   *
   * @default 'text'
   */
  format?: 'text' | 'messages' | 'raw' | 'both' | 'debug';

  /**
   * Include metadata wrapper around the response.
   * When true, adds timestamp and options to the output.
   *
   * @default false
   */
  includeMetadata?: boolean;

  /**
   * Custom formatter options for text/message formatting.
   * Allows customization of markers, preambles, and section descriptions.
   */
  formatterOptions?: FormatterOptions;

  /**
   * Simulate token usage statistics.
   * When true, estimates token counts based on character length.
   *
   * @default true
   */
  simulateUsage?: boolean;

  /**
   * Number of characters to send in each streaming chunk.
   * Lower values create more granular streaming.
   *
   * @default 100
   */
  streamChunkSize?: number;
}

/**
 * Echo driver that returns the formatted prompt instead of calling an AI model.
 * Primary use cases:
 * - Debugging: Inspect the exact prompt being sent to AI models
 * - Testing: Verify prompt generation without API calls
 * - Development: Quickly iterate on prompt design
 *
 * @example
 * // Debug prompt structure
 * const driver = new EchoDriver({ format: 'debug' });
 * const result = await driver.query(prompt);
 * console.log(JSON.parse(result.content));
 *
 * @example
 * // Test structured outputs with raw format
 * const driver = new EchoDriver({ format: 'raw' });
 * prompt.metadata = { outputSchema: { type: 'object' } };
 * const result = await driver.query(prompt);
 * // result.structuredOutput contains the entire prompt as JSON
 */
export class EchoDriver implements AIDriver {
  private format: EchoDriverConfig['format'];
  private includeMetadata: boolean;
  private simulateUsage: boolean;
  private streamChunkSize: number;
  private formatterOptions: FormatterOptions;

  constructor(config: EchoDriverConfig = {}) {
    this.format = config.format || 'text';
    this.includeMetadata = config.includeMetadata ?? false;
    this.simulateUsage = config.simulateUsage ?? true;
    this.streamChunkSize = config.streamChunkSize ?? 100;

    // Merge ECHO_SPECIAL_TOKENS with user-provided formatter options
    this.formatterOptions = {
      ...ECHO_SPECIAL_TOKENS,
      ...config.formatterOptions
    };
  }
  
  /**
   * Query implementation that echoes back the formatted prompt.
   * The format of the response depends on the configured format option.
   * Structured outputs are automatically extracted from JSON formats.
   */
  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    let content: string;

    // Format the prompt according to the configured format
    switch (this.format) {
      case 'text': {
        // Human-readable markdown format with Echo special tokens
        content = formatCompletionPrompt(prompt, this.formatterOptions);
        break;
      }

      case 'messages': {
        // Array of chat messages (for message-based API testing)
        const messages = formatPromptAsMessages(prompt, this.formatterOptions);
        content = JSON.stringify(messages, null, 2);
        break;
      }

      case 'raw': {
        // The entire CompiledPrompt object as JSON
        content = JSON.stringify(prompt, null, 2);
        break;
      }

      case 'both': {
        // Both text and messages in a single object
        const text = formatCompletionPrompt(prompt, this.formatterOptions);
        const messages = formatPromptAsMessages(prompt, this.formatterOptions);

        content = JSON.stringify({
          text,
          messages
        }, null, 2);
        break;
      }

      case 'debug': {
        const text = formatCompletionPrompt(prompt, this.formatterOptions);
        const messages = formatPromptAsMessages(prompt, this.formatterOptions);

        const debug = {
          raw: prompt,
          formatted: {
            text,
            messages
          },
          metadata: {
            instructionsCount: prompt.instructions?.length || 0,
            dataCount: prompt.data?.length || 0,
            outputCount: prompt.output?.length || 0,
            formatterOptions: this.formatterOptions,
            queryOptions: options
          }
        };

        content = JSON.stringify(debug, null, 2);
        break;
      }

      default:
        content = formatCompletionPrompt(prompt, this.formatterOptions);
    }
    
    // Add metadata if requested
    if (this.includeMetadata && this.format !== 'debug') {
      const metadata = {
        format: this.format,
        timestamp: new Date().toISOString(),
        options
      };
      content = `=== METADATA ===\n${JSON.stringify(metadata, null, 2)}\n\n=== CONTENT ===\n${content}`;
    }
    
    // Handle structured outputs if schema is provided
    let structuredOutput: unknown | undefined;
    if (prompt.metadata?.outputSchema) {
      // For echo driver, we'll generate a sample based on the format
      if (this.format === 'raw' || this.format === 'messages' || this.format === 'both' || this.format === 'debug') {
        // These formats already return JSON, so try to extract
        const extracted = extractJSON(content, { multiple: false });
        if (extracted.source !== 'none' && extracted.data !== null) {
          structuredOutput = extracted.data;
        }
      } else if (this.format === 'text') {
        // For text format, we could simulate a JSON response if schema is provided
        // For now, we'll just try to extract any JSON that might be in the text
        const extracted = extractJSON(content, { multiple: false });
        if (extracted.source !== 'none' && extracted.data !== null) {
          structuredOutput = extracted.data;
        }
      }
    }

    // Simulate usage if requested
    const usage = this.simulateUsage ? {
      promptTokens: Math.ceil(content.length / 4),
      completionTokens: 0,
      totalTokens: Math.ceil(content.length / 4)
    } : undefined;

    return {
      content,
      structuredOutput,
      finishReason: 'stop',
      usage
    };
  }
  
  /**
   * Stream query implementation
   */
  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
    const result = await this.query(prompt, options);
    const content = result.content;
    const chunkSize = this.streamChunkSize;

    // Create stream generator
    async function* streamGenerator(): AsyncIterable<string> {
      // Stream in chunks
      for (let i = 0; i < content.length; i += chunkSize) {
        yield content.slice(i, i + chunkSize);

        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    return {
      stream: streamGenerator(),
      result: Promise.resolve(result)
    };
  }
  
  /**
   * Close the driver
   */
  async close(): Promise<void> {
    // No resources to clean up
  }
}