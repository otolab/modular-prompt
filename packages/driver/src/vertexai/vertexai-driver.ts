import {
  VertexAI,
  GenerationConfig,
  HarmCategory,
  HarmBlockThreshold,
  FinishReason,
  GenerateContentRequest,
  ResponseSchema,
  SchemaType,
  FunctionCallingMode
} from '@google-cloud/vertexai';
import type { Part } from '@google-cloud/vertexai';
import type { CompiledPrompt, Element } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolCall, ToolDefinition, ToolChoice, ChatMessage } from '../types.js';
import { hasToolCalls, isToolResult } from '../types.js';

/**
 * VertexAI driver configuration
 */
export interface VertexAIDriverConfig {
  project?: string;
  location?: string;
  model?: string;
  temperature?: number;
  defaultOptions?: Partial<VertexAIQueryOptions>;
}

/**
 * VertexAI-specific query options
 */
export interface VertexAIQueryOptions extends QueryOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  responseFormat?: 'json' | 'text';
  jsonSchema?: unknown;
}

/**
 * Map finish reasons from VertexAI to our format
 */
const finishReasonMap: Record<FinishReason | 'error', QueryResult['finishReason']> = {
  FINISH_REASON_UNSPECIFIED: 'error',
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'stop',
  RECITATION: 'stop',
  OTHER: 'error',
  BLOCKLIST: 'error',
  PROHIBITED_CONTENT: 'error',
  SPII: 'error',
  error: 'error'
};

/**
 * VertexAI (Google Gemini) driver
 */
export class VertexAIDriver implements AIDriver {
  private vertexAI: VertexAI;
  private defaultModel: string;
  private defaultTemperature: number;
  private _defaultOptions: Partial<VertexAIQueryOptions>;

  get defaultOptions(): Partial<VertexAIQueryOptions> {
    return this._defaultOptions;
  }

  set defaultOptions(value: Partial<VertexAIQueryOptions>) {
    this._defaultOptions = value;
  }

  constructor(config: VertexAIDriverConfig = {}) {
    const project = config.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    const location = config.location || process.env.GOOGLE_CLOUD_REGION || process.env.CLOUD_ML_REGION || 'us-central1';

    if (!project) {
      throw new Error('VertexAI project ID is required. Set it in config or GOOGLE_CLOUD_PROJECT environment variable.');
    }

    this.vertexAI = new VertexAI({ project, location });
    this.defaultModel = config.model || 'gemini-2.0-flash-001';
    this.defaultTemperature = config.temperature ?? 0.05;
    this._defaultOptions = config.defaultOptions || {};
  }
  
  /**
   * Convert CompiledPrompt to VertexAI's format
   */
  private compiledPromptToVertexAI(prompt: CompiledPrompt): GenerateContentRequest {
    // Helper to extract message elements and convert others to text
    const processElements = (elements: Element[], defaultRole: 'system' | 'user' | 'assistant'): Array<{ role: 'user' | 'model'; parts: Part[] }> => {
      const result: Array<{ role: 'user' | 'model'; parts: Part[] }> = [];
      const textParts: string[] = [];

      for (const el of elements) {
        if (typeof el === 'string') {
          textParts.push(el);
        } else if (typeof el === 'object' && el !== null && 'type' in el) {
          if (el.type === 'message') {
            // Flush accumulated text first
            if (textParts.length > 0) {
              result.push({
                role: defaultRole === 'assistant' ? 'model' : 'user',
                parts: [{ text: textParts.join('\n') }]
              });
              textParts.length = 0;
            }

            // Handle tool/toolCalls messages
            if (el.role === 'tool') {
              const toolContent = typeof el.content === 'string' ? el.content : JSON.stringify(el.content);
              result.push({
                role: 'user',
                parts: [{ functionResponse: { name: el.name || el.toolCallId, response: JSON.parse(toolContent) } }]
              });
            } else if ('toolCalls' in el && el.toolCalls) {
              const parts: Part[] = [];
              const content = typeof el.content === 'string' ? el.content : JSON.stringify(el.content);
              if (content) parts.push({ text: content });
              for (const tc of el.toolCalls) {
                parts.push({ functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } });
              }
              result.push({ role: 'model', parts });
            } else {
              // Standard message
              result.push({
                role: el.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: typeof el.content === 'string' ? el.content : JSON.stringify(el.content) }]
              });
            }
          } else if ('content' in el) {
            textParts.push(typeof el.content === 'string' ? el.content : JSON.stringify(el.content));
          } else {
            textParts.push(JSON.stringify(el));
          }
        }
      }

      // Flush remaining text
      if (textParts.length > 0) {
        result.push({
          role: defaultRole === 'assistant' ? 'model' : 'user',
          parts: [{ text: textParts.join('\n') }]
        });
      }

      return result;
    };

    // Process each section
    const systemParts: string[] = [];
    const contents: Array<{ role: 'user' | 'model'; parts: Part[] }> = [];

    // Instructions → system instruction (text only, no message elements expected here)
    if (prompt.instructions && prompt.instructions.length > 0) {
      for (const el of prompt.instructions) {
        if (typeof el === 'string') {
          systemParts.push(el);
        } else if (typeof el === 'object' && el !== null && 'content' in el) {
          systemParts.push(typeof el.content === 'string' ? el.content : JSON.stringify(el.content));
        } else {
          systemParts.push(JSON.stringify(el));
        }
      }
    }

    // Data + Output → contents (may contain message elements)
    if (prompt.data && prompt.data.length > 0) {
      contents.push(...processElements(prompt.data, 'user'));
    }
    if (prompt.output && prompt.output.length > 0) {
      contents.push(...processElements(prompt.output, 'user'));
    }

    // Ensure at least one user message
    if (contents.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: 'Please process according to the instructions.' }]
      });
    }

    return {
      contents,
      systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined
    };
  }

  /**
   * Convert ChatMessage to VertexAI Content format
   */
  private chatMessageToContent(message: ChatMessage): { role: 'user' | 'model'; parts: Part[] } {
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
   * Convert messages to VertexAI's format
   */
  private convertMessages(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): GenerateContentRequest {
    // Separate system messages from conversation
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversation = messages.filter(m => m.role !== 'system');
    
    // Merge all system messages into one
    const systemInstruction = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : undefined;
    
    // Convert conversation messages
    const contents = conversation.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));
    
    // Ensure we have at least one user message
    if (contents.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: 'Please process according to the instructions.' }]
      });
    }
    
    // Ensure conversation starts with user
    if (contents.length > 0 && contents[0].role !== 'user') {
      contents.unshift({
        role: 'user',
        parts: [{ text: 'Continue.' }]
      });
    }
    
    // Ensure conversation alternates between user and model
    const processedContents = [];
    let lastRole = '';
    for (const content of contents) {
      if (content.role === lastRole) {
        // Same role twice, insert opposite role
        processedContents.push({
          role: lastRole === 'user' ? 'model' : 'user',
          parts: [{ text: lastRole === 'user' ? 'Continue.' : 'Please continue.' }]
        });
      }
      processedContents.push(content);
      lastRole = content.role;
    }
    
    // Ensure conversation ends with user
    if (processedContents.length > 0 && processedContents[processedContents.length - 1].role === 'model') {
      processedContents.push({
        role: 'user',
        parts: [{ text: 'Please continue.' }]
      });
    }
    
    return {
      contents: processedContents,
      systemInstruction
    };
  }
  
  /**
   * Convert JSON Schema to VertexAI ResponseSchema
   */
  private convertJsonSchema(schema: unknown): ResponseSchema | undefined {
    if (!schema) return undefined;
    
    const typeMap: Record<string, SchemaType> = {
      string: SchemaType.STRING,
      number: SchemaType.NUMBER,
      integer: SchemaType.INTEGER,
      boolean: SchemaType.BOOLEAN,
      array: SchemaType.ARRAY,
      object: SchemaType.OBJECT
    };
    
    const convertSchema = (s: Record<string, unknown>): ResponseSchema => {
      const result: Record<string, unknown> = { ...s };
      
      if (s.type && typeof s.type === 'string') {
        result.type = typeMap[s.type] || SchemaType.STRING;
      }
      
      if (s.properties) {
        result.properties = Object.fromEntries(
          Object.entries(s.properties)
            .map(([k, v]) => [k, convertSchema(v as Record<string, unknown>)])
        );
      }
      
      if (s.items) {
        result.items = convertSchema(s.items as Record<string, unknown>);
      }
      
      return result as ResponseSchema;
    };
    
    return convertSchema(schema as Record<string, unknown>);
  }
  
  /**
   * Convert ToolDefinition[] to VertexAI tools format
   */
  private convertTools(tools: ToolDefinition[]) {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        // JSON Schema → VertexAI FunctionDeclarationSchema (reuse convertJsonSchema + cast)
        ...(tool.function.parameters
          ? { parameters: this.convertJsonSchema(tool.function.parameters) as unknown as import('@google-cloud/vertexai').FunctionDeclarationSchema }
          : {}),
      }))
    }];
  }

  /**
   * Convert ToolChoice to VertexAI ToolConfig
   */
  private convertToolChoice(toolChoice: ToolChoice) {
    if (toolChoice === 'auto') {
      return { functionCallingConfig: { mode: FunctionCallingMode.AUTO } };
    }
    if (toolChoice === 'none') {
      return { functionCallingConfig: { mode: FunctionCallingMode.NONE } };
    }
    if (toolChoice === 'required') {
      return { functionCallingConfig: { mode: FunctionCallingMode.ANY } };
    }
    return {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: [toolChoice.function.name],
      },
    };
  }

  /**
   * Extract ToolCalls from response parts
   */
  private extractToolCalls(parts: Part[] | undefined): ToolCall[] {
    if (!parts) return [];
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if ('functionCall' in part && part.functionCall) {
        const fc = part.functionCall;
        toolCalls.push({
          id: `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: fc.name,
            arguments: JSON.stringify(fc.args ?? {}),
          },
        });
      }
    }
    return toolCalls;
  }

  /**
   * Create a generative model client
   */
  private createClient(model: string, config: GenerationConfig) {
    const options = {
      model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        }
      ],
      generationConfig: config
    };
    
    // Use preview API for preview models
    if (model.includes('-preview-')) {
      return this.vertexAI.preview.getGenerativeModel(options);
    } else {
      return this.vertexAI.getGenerativeModel(options);
    }
  }
  
  /**
   * Query implementation
   */
  async query(
    prompt: CompiledPrompt,
    options: VertexAIQueryOptions = {}
  ): Promise<QueryResult> {
    try {
      // Merge options with defaults
      const mergedOptions = { ...this.defaultOptions, ...options };

      // Convert prompt to VertexAI format
      const request = this.compiledPromptToVertexAI(prompt);

      // Create generation config
      const generationConfig: GenerationConfig = {
        maxOutputTokens: mergedOptions.maxTokens || 1000,
        temperature: mergedOptions.temperature ?? this.defaultTemperature,
        topP: mergedOptions.topP,
        topK: mergedOptions.topK,
        responseMimeType: prompt.metadata?.outputSchema ? 'application/json' : 'text/plain',
        responseSchema: this.convertJsonSchema(prompt.metadata?.outputSchema)
      };
      
      // Remove undefined values
      Object.keys(generationConfig).forEach(key => {
        if (generationConfig[key as keyof GenerationConfig] === undefined) {
          delete generationConfig[key as keyof GenerationConfig];
        }
      });
      
      // Add tools configuration
      if (mergedOptions.tools && mergedOptions.tools.length > 0) {
        request.tools = this.convertTools(mergedOptions.tools);
      }
      if (mergedOptions.toolChoice) {
        request.toolConfig = this.convertToolChoice(mergedOptions.toolChoice);
      }

      // Create client and generate
      const model = mergedOptions.model || this.defaultModel;
      const client = this.createClient(model, generationConfig);
      const result = await client.generateContent(request);
      
      // Extract response
      const response = result.response;
      const candidate = response.candidates?.[0];
      
      if (!candidate || !candidate.content) {
        return {
          content: '',
          finishReason: 'error'
        };
      }
      
      // Extract text content
      const content = candidate.content.parts
        .map(part => part.text || '')
        .join('');

      // Extract tool calls
      const toolCalls = this.extractToolCalls(candidate.content.parts as Part[]);

      // Map finish reason
      let finishReason = finishReasonMap[candidate.finishReason || 'error'];
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
      console.error('[VertexAIDriver] Query error:', error);
      if (error instanceof Error) {
        console.error('[VertexAIDriver] Error message:', error.message);
        console.error('[VertexAIDriver] Error stack:', error.stack);
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
    options?: VertexAIQueryOptions
  ): Promise<StreamResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    // Convert prompt to VertexAI format
    const request = this.compiledPromptToVertexAI(prompt);

    // Create generation config
    const generationConfig: GenerationConfig = {
      maxOutputTokens: mergedOptions.maxTokens || 1000,
      temperature: mergedOptions.temperature ?? this.defaultTemperature,
      responseMimeType: prompt.metadata?.outputSchema ? 'application/json' : 'text/plain',
      responseSchema: this.convertJsonSchema(prompt.metadata?.outputSchema)
    };

    // Remove undefined values
    Object.keys(generationConfig).forEach(key => {
      if (generationConfig[key as keyof GenerationConfig] === undefined) {
        delete generationConfig[key as keyof GenerationConfig];
      }
    });

    // Add tools configuration
    if (mergedOptions.tools && mergedOptions.tools.length > 0) {
      request.tools = this.convertTools(mergedOptions.tools);
    }
    if (mergedOptions.toolChoice) {
      request.toolConfig = this.convertToolChoice(mergedOptions.toolChoice);
    }

    // Create client and generate stream
    const model = mergedOptions.model || this.defaultModel;
    const client = this.createClient(model, generationConfig);
    const streamingResult = await client.generateContentStream(request);

    // Create stream generator
    async function* streamGenerator(): AsyncIterable<string> {
      for await (const chunk of streamingResult.stream) {
        if (chunk?.candidates?.[0]?.content?.parts?.[0]?.text) {
          yield chunk.candidates[0].content.parts[0].text;
        }
      }
    }

    // Create result promise
    const resultPromise = (async (): Promise<QueryResult> => {
      // Aggregate the response from streaming
      const response = await streamingResult.response;
      const candidate = response.candidates?.[0];

      if (!candidate || !candidate.content) {
        return {
          content: '',
          finishReason: 'error'
        };
      }

      // Extract text content
      const content = candidate.content.parts
        .map(part => part.text || '')
        .join('');

      // Extract tool calls
      const toolCalls = this.extractToolCalls(candidate.content.parts as Part[]);

      // Map finish reason
      let finishReason = finishReasonMap[candidate.finishReason || 'error'];
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
    // VertexAI client doesn't need explicit closing
  }
}