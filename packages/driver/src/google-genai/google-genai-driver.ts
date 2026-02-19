import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { Part, Content, FunctionDeclaration, FunctionCallingConfig } from '@google/genai';
import type { CompiledPrompt, Element } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolDefinition, ToolChoice, ToolCall, ChatMessage } from '../types.js';
import { hasToolCalls, isToolResult } from '../types.js';

/**
 * GoogleGenAI driver configuration
 */
export interface GoogleGenAIDriverConfig {
  apiKey?: string;
  model?: string;
  temperature?: number;
  defaultOptions?: Partial<GoogleGenAIQueryOptions>;
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
  }

  /**
   * Convert content (string or Attachment[]) to string
   */
  private contentToString(content: string | unknown[]): string {
    if (typeof content === 'string') {
      return content;
    }
    // For Attachment[], extract text content
    // TODO: In the future, handle image_url and file attachments for multimodal support
    return content
      .filter((att: unknown) => {
        const a = att as { type?: string; text?: string };
        return a.type === 'text' && a.text;
      })
      .map((att: unknown) => (att as { text: string }).text)
      .join('\n');
  }

  /**
   * Convert Element to Part (flat text conversion)
   * Used for systemInstruction and simple data
   */
  private elementToPart(element: Element | string): Part {
    if (typeof element === 'string') {
      return { text: element };
    }

    switch (element.type) {
      case 'text':
        return { text: element.content };

      case 'message': {
        // Flatten message as text
        const messageContent = this.contentToString(element.content);
        return { text: `${element.role}: ${messageContent}` };
      }

      case 'material': {
        const materialContent = this.contentToString(element.content);
        return { text: `# ${element.title}\n${materialContent}` };
      }

      case 'chunk': {
        const chunkContent = this.contentToString(element.content);
        const chunkHeader = element.index !== undefined && element.total !== undefined
          ? `[Chunk ${element.index + 1}/${element.total} of ${element.partOf}]`
          : `[Chunk of ${element.partOf}]`;
        return { text: `${chunkHeader}\n${chunkContent}` };
      }

      case 'section':
      case 'subsection': {
        // Section/SubSection elements should be compiled before reaching here
        // If they do reach here, flatten their items recursively
        const flattenItems = (items: unknown[]): string => {
          return items.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item === 'function') return ''; // DynamicContent should be resolved before this point
            return this.elementToPart(item as Element).text || '';
          }).filter(Boolean).join('\n');
        };
        return { text: flattenItems(element.items) };
      }

      case 'json':
        return { text: typeof element.content === 'string' ? element.content : JSON.stringify(element.content, null, 2) };

      default:
        return { text: JSON.stringify(element) };
    }
  }

  /**
   * Convert Element to Content (structure-preserving conversion)
   * Used for conversation history where role matters
   */
  private elementToContent(element: Element | string): Content {
    if (typeof element === 'string') {
      return { parts: [{ text: element }] };
    }

    if (element.type === 'message') {
      // Role conversion:
      // - assistant → model
      // - system → user (Gemini API doesn't support system role in contents)
      // - user → user
      const role = element.role === 'assistant' ? 'model' : 'user';
      const messageContent = this.contentToString(element.content);
      return {
        role,
        parts: [{ text: messageContent }]
      };
    }

    // Non-message elements: convert to Part and wrap in Content without role
    return {
      parts: [this.elementToPart(element)]
    };
  }

  /**
   * Convert ChatMessage to GoogleGenAI Content format
   */
  private chatMessageToContent(message: ChatMessage): Content {
    if (hasToolCalls(message)) {
      // AssistantToolCallMessage
      const parts: Part[] = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      for (const tc of message.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments)
          }
        });
      }
      return { role: 'model', parts };
    } else if (isToolResult(message)) {
      // ToolResultMessage
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: message.name || message.toolCallId,
            response: JSON.parse(message.content)
          }
        }]
      };
    } else {
      // StandardChatMessage
      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }]
      };
    }
  }


  /**
   * Convert JSON Schema to GoogleGenAI Schema format
   */
  private convertJsonSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') return undefined;

    // GoogleGenAI uses a specific schema format
    // For now, we'll pass it through and let the API handle it
    return schema;
  }

  /**
   * Convert ToolDefinition[] to GoogleGenAI tools format
   */
  private convertTools(tools: ToolDefinition[]): { functionDeclarations: FunctionDeclaration[] }[] {
    const functionDeclarations: FunctionDeclaration[] = tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      parametersJsonSchema: tool.function.parameters,
    }));
    return [{ functionDeclarations }];
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
      allowedFunctionNames: [toolChoice.function.name],
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
        toolCalls.push({
          id: fc.id || `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: fc.name || '',
            arguments: JSON.stringify(fc.args ?? {}),
          },
        });
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

      // Convert prompt to GoogleGenAI format
      // Instructions → systemInstruction (Part[])
      const systemInstructionParts = prompt.instructions?.map(el => this.elementToPart(el));

      // Data + Output → contents (Content[])
      const allDataElements = [...(prompt.data || []), ...(prompt.output || [])];
      let contents = allDataElements.length > 0
        ? allDataElements.map(el => this.elementToContent(el))
        : [{ parts: [{ text: 'Please process according to the instructions.' }] }];

      // Append options.messages if provided
      if (options?.messages && options.messages.length > 0) {
        const additionalContents = options.messages.map(msg => this.chatMessageToContent(msg));
        contents = [...contents, ...additionalContents];
      }

      // Create generation config
      const config: Record<string, unknown> = {
        temperature: mergedOptions.temperature ?? this.defaultTemperature,
        maxOutputTokens: mergedOptions.maxTokens,
        topP: mergedOptions.topP,
        topK: mergedOptions.topK,
        candidateCount: mergedOptions.candidateCount,
        stopSequences: mergedOptions.stopSequences,
        thinkingConfig: mergedOptions.thinkingConfig,
      };

      // Add system instruction if present
      if (systemInstructionParts && systemInstructionParts.length > 0) {
        config.systemInstruction = systemInstructionParts;
      }

      // Handle structured outputs
      if (prompt.metadata?.outputSchema) {
        config.responseMimeType = 'application/json';
        config.responseSchema = this.convertJsonSchema(prompt.metadata.outputSchema);
      }

      // Add tools configuration
      if (mergedOptions.tools && mergedOptions.tools.length > 0) {
        config.tools = this.convertTools(mergedOptions.tools);
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

      // Get model name
      const model = mergedOptions.model || this.defaultModel;

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
        } : undefined
      };
    } catch (error) {
      console.error('[GoogleGenAIDriver] Query error:', error);
      if (error instanceof Error) {
        console.error('[GoogleGenAIDriver] Error message:', error.message);
        console.error('[GoogleGenAIDriver] Error stack:', error.stack);
      }
      return {
        content: '',
        finishReason: 'error'
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

    // Convert prompt to GoogleGenAI format
    // Instructions → systemInstruction (Part[])
    const systemInstructionParts = prompt.instructions?.map(el => this.elementToPart(el));

    // Data + Output → contents (Content[])
    const allDataElements = [...(prompt.data || []), ...(prompt.output || [])];
    let contents = allDataElements.length > 0
      ? allDataElements.map(el => this.elementToContent(el))
      : [{ parts: [{ text: 'Please process according to the instructions.' }] }];

    // Append options.messages if provided
    if (options?.messages && options.messages.length > 0) {
      const additionalContents = options.messages.map(msg => this.chatMessageToContent(msg));
      contents = [...contents, ...additionalContents];
    }

    // Create generation config
    const config: Record<string, unknown> = {
      temperature: mergedOptions.temperature ?? this.defaultTemperature,
      maxOutputTokens: mergedOptions.maxTokens,
      topP: mergedOptions.topP,
      topK: mergedOptions.topK,
      candidateCount: mergedOptions.candidateCount,
      stopSequences: mergedOptions.stopSequences,
      thinkingConfig: mergedOptions.thinkingConfig,
    };

    // Add system instruction if present
    if (systemInstructionParts && systemInstructionParts.length > 0) {
      config.systemInstruction = systemInstructionParts;
    }

    // Handle structured outputs
    if (prompt.metadata?.outputSchema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = this.convertJsonSchema(prompt.metadata.outputSchema);
    }

    // Add tools configuration
    if (mergedOptions.tools && mergedOptions.tools.length > 0) {
      config.tools = this.convertTools(mergedOptions.tools);
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

    // Get model name
    const model = mergedOptions.model || this.defaultModel;

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
      } catch {
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
        finishReason
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
    // GoogleGenAI client doesn't need explicit closing
  }
}
