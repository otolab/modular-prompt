import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { Part, Content, FunctionCallingConfig } from '@google/genai';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolChoice, ToolCall, ChatMessage } from '../types.js';
import { hasToolCalls, isToolResult } from '../types.js';
import { contentToString } from '../content-utils.js';
import { QueryLogger } from '../query-logger.js';
import type { PromptCacheController, CacheHandle } from '../cache-controller.js';
import { partitionPrompt } from '../cache-utils.js';
import { elementToPart, elementToContent, toFunctionResponsePayload, convertTools, mergeToolResultContents } from './element-converter.js';

/**
 * GoogleGenAI driver configuration
 */
export interface GoogleGenAIDriverConfig {
  apiKey?: string;
  model?: string;
  temperature?: number;
  defaultOptions?: Partial<GoogleGenAIQueryOptions>;
  cacheController?: PromptCacheController;
}

/**
 * GoogleGenAI-specific query options
 */
export interface GoogleGenAIQueryOptions extends QueryOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  stopSequences?: string[];
  thinkingConfig?: {
    thinkingLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  };
}

/**
 * Map finish reasons from GoogleGenAI to our format
 */
const finishReasonMap: Record<string, QueryResult['finishReason']> = {
  'FINISH_REASON_UNSPECIFIED': 'error',
  'STOP': 'stop',
  'MAX_TOKENS': 'length',
  'SAFETY': 'stop',
  'RECITATION': 'stop',
  'LANGUAGE': 'error',
  'OTHER': 'error',
  'BLOCKLIST': 'error',
  'PROHIBITED_CONTENT': 'error',
  'MALFORMED_FUNCTION_CALL': 'error',
  'error': 'error'
};

/**
 * GoogleGenAI driver
 */
export class GoogleGenAIDriver implements AIDriver {
  private client: GoogleGenAI;
  private defaultModel: string;
  private defaultTemperature: number;
  private _defaultOptions: Partial<GoogleGenAIQueryOptions>;
  private queryLogger = new QueryLogger('GoogleGenAI');
  private cacheController?: PromptCacheController;

  get defaultOptions(): Partial<GoogleGenAIQueryOptions> {
    return this._defaultOptions;
  }

  set defaultOptions(value: Partial<GoogleGenAIQueryOptions>) {
    this._defaultOptions = value;
  }

  constructor(config: GoogleGenAIDriverConfig = {}) {
    const apiKey = config.apiKey || process.env.GOOGLE_GENAI_API_KEY;

    if (!apiKey) {
      throw new Error('GoogleGenAI API key is required. Set it in config or GOOGLE_GENAI_API_KEY environment variable.');
    }

    this.client = new GoogleGenAI({ apiKey });
    this.defaultModel = config.model || 'gemma-3-27b';
    this.defaultTemperature = config.temperature ?? 0.7;
    this._defaultOptions = config.defaultOptions || {};
    this.cacheController = config.cacheController;
  }

  private async buildPromptPayload(
    prompt: CompiledPrompt,
    mergedOptions: GoogleGenAIQueryOptions,
    model: string
  ): Promise<{
    systemInstructionParts: ReturnType<typeof elementToPart>[] | undefined;
    contents: Content[];
    cacheHandle: CacheHandle | null;
  }> {
    if (this.cacheController) {
      const partition = partitionPrompt(prompt);
      const hasCacheableContent =
        partition.cacheable.instructions.length > 0 ||
        partition.cacheable.data.length > 0 ||
        (mergedOptions.tools && mergedOptions.tools.length > 0);

      if (hasCacheableContent) {
        const handle = await this.cacheController.prepare({
          model,
          instructions: partition.cacheable.instructions,
          data: partition.cacheable.data,
          tools: mergedOptions.tools,
        });
        const uncachedInstructionParts = partition.volatile.instructions.length > 0
          ? partition.volatile.instructions.map(el => elementToPart(el))
          : undefined;
        const volatileElements = [...partition.volatile.data, ...partition.volatile.output];
        const contents = volatileElements.length > 0
          ? mergeToolResultContents(volatileElements.map(el => elementToContent(el)))
          : [{ parts: [{ text: 'Please process according to the instructions.' }] }];
        return { systemInstructionParts: uncachedInstructionParts, contents, cacheHandle: handle };
      }
    }

    const systemInstructionParts = prompt.instructions?.map(el => elementToPart(el));
    const allDataElements = [...(prompt.data || []), ...(prompt.output || [])];
    const contents = allDataElements.length > 0
      ? mergeToolResultContents(allDataElements.map(el => elementToContent(el)))
      : [{ parts: [{ text: 'Please process according to the instructions.' }] }];
    return { systemInstructionParts, contents, cacheHandle: null };
  }

  private chatMessageToContent(message: ChatMessage): Content {
    if (hasToolCalls(message)) {
      const parts: Part[] = [];
      const textContent = contentToString(message.content);
      if (textContent) {
        parts.push({ text: textContent });
      }
      for (const tc of message.toolCalls) {
        const part: Part = {
          functionCall: { name: tc.name, args: tc.arguments as Record<string, unknown> }
        };
        if (typeof tc.metadata?.thoughtSignature === 'string') {
          part.thoughtSignature = tc.metadata.thoughtSignature;
        }
        parts.push(part);
      }
      return { role: 'model', parts };
    } else if (isToolResult(message)) {
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: message.name,
            response: toFunctionResponsePayload(message.kind, message.value)
          }
        }]
      };
    } else {
      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: contentToString(message.content) }]
      };
    }
  }

  private convertJsonSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') return undefined;
    return schema;
  }

  /**
   * Convert ToolChoice to GoogleGenAI FunctionCallingConfig
   */
  private convertToolChoice(toolChoice: ToolChoice): FunctionCallingConfig {
    if (toolChoice === 'auto') {
      return { mode: FunctionCallingConfigMode.AUTO };
    }
    if (toolChoice === 'none') {
      return { mode: FunctionCallingConfigMode.NONE };
    }
    if (toolChoice === 'required') {
      return { mode: FunctionCallingConfigMode.ANY };
    }
    // Specific function
    return {
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: [toolChoice.name],
    };
  }

  /**
   * Extract ToolCalls from response parts
   */
  private extractToolCalls(parts: Part[] | undefined): ToolCall[] {
    if (!parts) return [];
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if (part.functionCall) {
        const fc = part.functionCall;
        const toolCall: ToolCall = {
          id: fc.id || `call_${toolCalls.length}`,
          name: fc.name || '',
          arguments: fc.args ?? {},
        };
        if (typeof part.thoughtSignature === 'string') {
          toolCall.metadata = { thoughtSignature: part.thoughtSignature };
        }
        toolCalls.push(toolCall);
      }
    }
    return toolCalls;
  }

  /**
   * Query implementation
   */
  async query(
    prompt: CompiledPrompt,
    options: GoogleGenAIQueryOptions = {}
  ): Promise<QueryResult> {
    try {
      // Merge options with defaults
      const mergedOptions = { ...this.defaultOptions, ...options };
      this.queryLogger.mark(mergedOptions);
      const model = mergedOptions.model || this.defaultModel;

      const { systemInstructionParts, contents, cacheHandle } =
        await this.buildPromptPayload(prompt, mergedOptions, model);

      // Create generation config
      const config: Record<string, unknown> = {
        temperature: mergedOptions.temperature ?? this.defaultTemperature,
        maxOutputTokens: mergedOptions.maxTokens,
        topP: mergedOptions.topP,
        topK: mergedOptions.topK,
        candidateCount: mergedOptions.candidateCount,
        stopSequences: mergedOptions.stopSequences,
        thinkingConfig: mergedOptions.thinkingConfig ??
          (mergedOptions.mode === 'thinking' ? { thinkingLevel: 'HIGH' } : undefined),
      };

      if (cacheHandle) {
        config.cachedContent = cacheHandle.ref;
        if (!cacheHandle.includes.tools && mergedOptions.tools && mergedOptions.tools.length > 0) {
          config.tools = convertTools(mergedOptions.tools);
        }
      } else {
        if (mergedOptions.tools && mergedOptions.tools.length > 0) {
          config.tools = convertTools(mergedOptions.tools);
        }
      }

      if (systemInstructionParts && systemInstructionParts.length > 0) {
        config.systemInstruction = systemInstructionParts;
      }

      // Handle structured outputs
      if (prompt.metadata?.outputSchema) {
        config.responseMimeType = 'application/json';
        config.responseSchema = this.convertJsonSchema(prompt.metadata.outputSchema);
      }

      if (mergedOptions.toolChoice) {
        config.toolConfig = {
          functionCallingConfig: this.convertToolChoice(mergedOptions.toolChoice),
        };
      }

      // Remove undefined values
      Object.keys(config).forEach(key => {
        if (config[key] === undefined) {
          delete config[key];
        }
      });

      // Generate content
      const response = await this.client.models.generateContent({
        model,
        contents,
        config
      });

      // Extract text content using convenience property
      let content = '';
      try {
        content = response.text || '';
      } catch {
        // response.text throws if there are no text parts (e.g. tool-call-only response)
      }

      // Extract candidate for finish reason and tool calls
      const candidate = response.candidates?.[0];
      const toolCalls = this.extractToolCalls(candidate?.content?.parts as Part[] | undefined);

      // Map finish reason
      let finishReason = finishReasonMap[candidate?.finishReason || 'error'] || 'error';
      if (toolCalls.length > 0) {
        finishReason = 'tool_calls';
      }

      // Handle structured outputs
      let structuredOutput: unknown | undefined;
      if (prompt.metadata?.outputSchema && content) {
        try {
          structuredOutput = JSON.parse(content);
        } catch {
          // Keep as text if not valid JSON
        }
      }

      return {
        content,
        finishReason,
        structuredOutput,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: response.usageMetadata ? {
          promptTokens: response.usageMetadata.promptTokenCount || 0,
          completionTokens: response.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata.totalTokenCount || 0
        } : undefined,
        ...this.queryLogger.collect()
      };
    } catch (error) {
      this.queryLogger.log.error('Query error:', error instanceof Error ? error.message : String(error));
      return {
        content: '',
        finishReason: 'error',
        ...this.queryLogger.collect()
      };
    }
  }

  /**
   * Stream query implementation
   */
  async streamQuery(
    prompt: CompiledPrompt,
    options?: GoogleGenAIQueryOptions
  ): Promise<StreamResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    this.queryLogger.mark(mergedOptions);
    const model = mergedOptions.model || this.defaultModel;

    const { systemInstructionParts, contents, cacheHandle } =
      await this.buildPromptPayload(prompt, mergedOptions, model);

    // Create generation config
    const config: Record<string, unknown> = {
      temperature: mergedOptions.temperature ?? this.defaultTemperature,
      maxOutputTokens: mergedOptions.maxTokens,
      topP: mergedOptions.topP,
      topK: mergedOptions.topK,
      candidateCount: mergedOptions.candidateCount,
      stopSequences: mergedOptions.stopSequences,
      thinkingConfig: mergedOptions.thinkingConfig ??
        (mergedOptions.mode === 'thinking' ? { thinkingLevel: 'HIGH' } : undefined),
    };

    if (cacheHandle) {
      config.cachedContent = cacheHandle.ref;
      if (!cacheHandle.includes.tools && mergedOptions.tools && mergedOptions.tools.length > 0) {
        config.tools = convertTools(mergedOptions.tools);
      }
    } else {
      if (mergedOptions.tools && mergedOptions.tools.length > 0) {
        config.tools = convertTools(mergedOptions.tools);
      }
    }

    if (systemInstructionParts && systemInstructionParts.length > 0) {
      config.systemInstruction = systemInstructionParts;
    }

    // Handle structured outputs
    if (prompt.metadata?.outputSchema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = this.convertJsonSchema(prompt.metadata.outputSchema);
    }

    if (mergedOptions.toolChoice) {
      config.toolConfig = {
        functionCallingConfig: this.convertToolChoice(mergedOptions.toolChoice),
      };
    }

    // Remove undefined values
    Object.keys(config).forEach(key => {
      if (config[key] === undefined) {
        delete config[key];
      }
    });

    // Generate content stream
    const streamResponse = await this.client.models.generateContentStream({
      model,
      contents,
      config
    });

    // Shared state for accumulating content and metadata
    let fullContent = '';
    let usage: QueryResult['usage'] | undefined;
    let finishReason: QueryResult['finishReason'] = 'stop';
    let streamConsumed = false;
    const chunks: string[] = [];
    const accumulatedToolCalls: ToolCall[] = [];

    // Process the stream and cache chunks
    const processStream = async () => {
      try {
        for await (const chunk of streamResponse) {
          // Extract text - use try/catch as .text may throw for non-text parts
          let text: string | undefined;
          try {
            text = chunk.text;
          } catch {
            // No text content in this chunk
          }
          if (text) {
            fullContent += text;
            chunks.push(text);
          }

          // Extract tool calls from chunk parts
          const parts = chunk.candidates?.[0]?.content?.parts;
          if (parts) {
            const chunkToolCalls = this.extractToolCalls(parts as Part[]);
            accumulatedToolCalls.push(...chunkToolCalls);
          }

          // Update finish reason if provided
          if (chunk.candidates?.[0]?.finishReason) {
            const reason = chunk.candidates[0].finishReason;
            finishReason = finishReasonMap[reason] || 'error';
          }

          // Accumulate usage if provided
          if (chunk.usageMetadata) {
            usage = {
              promptTokens: chunk.usageMetadata.promptTokenCount || 0,
              completionTokens: chunk.usageMetadata.candidatesTokenCount || 0,
              totalTokens: chunk.usageMetadata.totalTokenCount || 0
            };
          }
        }
      } catch (error) {
        this.queryLogger.log.error('Stream error:', error instanceof Error ? error.message : String(error));
        finishReason = 'error';
      }

      // Override finish reason if tool calls were found
      if (accumulatedToolCalls.length > 0) {
        finishReason = 'tool_calls';
      }

      streamConsumed = true;
    };

    // Start processing the stream
    const processingPromise = processStream();

    // Create the stream generator that yields cached chunks (text only)
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
    const resultPromise = (async () => {
      await processingPromise;

      // Handle structured outputs
      let structuredOutput: unknown | undefined;
      if (prompt.metadata?.outputSchema && fullContent) {
        try {
          structuredOutput = JSON.parse(fullContent);
        } catch {
          // Keep as undefined if parsing fails
        }
      }

      return {
        content: fullContent,
        structuredOutput,
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        usage,
        finishReason,
        ...this.queryLogger.collect()
      };
    })();

    return {
      stream: streamGenerator(),
      result: resultPromise
    };
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    await this.cacheController?.close();
  }
}
