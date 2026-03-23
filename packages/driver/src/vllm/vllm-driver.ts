/**
 * vLLM driver
 *
 * 独立して起動された vLLM エンジンプロセスに Unix ドメインソケットで接続し推論を行う。
 *
 * エンジンの起動:
 *   uv --project <path> run python __main__.py \
 *     --model Qwen/Qwen2.5-7B-Instruct \
 *     --socket /tmp/vllm.sock \
 *     --tool-call-parser hermes
 *
 * ツール呼び出しは vLLM の ToolParserManager で Python 側がパースし、
 * 構造化された JSON で返す。TypeScript 側でのテキストパースは不要。
 */

import type { Attachment } from '@modular-prompt/core';
import type { AIDriver, QueryOptions, QueryResult, StreamResult, ToolCall, FinishReason } from '../types.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import { extractJSON, Logger } from '@modular-prompt/utils';
import { contentToString } from '../content-utils.js';
import { VllmProcess, type VllmCapabilities } from './vllm-process.js';
import { Readable } from 'stream';

const logger = new Logger({ prefix: 'vLLM', context: 'driver' });

/**
 * vLLM driver configuration
 */
export interface VllmDriverConfig {
  /** Unix ドメインソケットパス（vLLM エンジンが listen しているパス） */
  socketPath: string;
  defaultOptions?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    repetitionPenalty?: number;
  };
  formatterOptions?: FormatterOptions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertMessages(
  messages: Array<{ role: string; content: string | Attachment[] }>
): Array<{ role: string; content: string }> {
  return messages.map(msg => ({
    role: msg.role,
    content: contentToString(msg.content),
  }));
}

function mapOptions(
  defaults: VllmDriverConfig['defaultOptions'],
  queryOptions?: QueryOptions
): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (defaults?.maxTokens !== undefined) opts.max_tokens = defaults.maxTokens;
  if (defaults?.temperature !== undefined) opts.temperature = defaults.temperature;
  if (defaults?.topP !== undefined) opts.top_p = defaults.topP;
  if (defaults?.topK !== undefined) opts.top_k = defaults.topK;
  if (defaults?.repetitionPenalty !== undefined) opts.repetition_penalty = defaults.repetitionPenalty;
  if (queryOptions?.maxTokens !== undefined) opts.max_tokens = queryOptions.maxTokens;
  if (queryOptions?.temperature !== undefined) opts.temperature = queryOptions.temperature;
  if (queryOptions?.topP !== undefined) opts.top_p = queryOptions.topP;
  return opts;
}

function convertToolDefinitions(tools: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function createStreamIterable(stream: Readable): {
  iterable: AsyncIterable<string>;
  completion: Promise<{ content: string; error: Error | null }>;
} {
  const chunks: string[] = [];
  let resolveCompletion: (value: { content: string; error: Error | null }) => void;
  const completion = new Promise<{ content: string; error: Error | null }>((resolve) => {
    resolveCompletion = resolve;
  });
  const iterable = {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      try {
        for await (const chunk of stream) {
          const str = chunk.toString();
          chunks.push(str);
          yield str;
        }
        resolveCompletion({ content: chunks.join(''), error: null });
      } catch (error) {
        resolveCompletion({ content: chunks.join(''), error: error as Error });
        throw error;
      }
    }
  };
  return { iterable, completion };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class VllmDriver implements AIDriver {
  private process: VllmProcess;
  private defaultOptions: VllmDriverConfig['defaultOptions'];
  private capabilities: VllmCapabilities | null = null;
  private formatterOptions: FormatterOptions;

  constructor(config: VllmDriverConfig) {
    this.defaultOptions = config.defaultOptions || {};
    this.formatterOptions = config.formatterOptions || {};
    this.process = new VllmProcess(config.socketPath);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.capabilities) {
      try {
        this.capabilities = await this.process.getCapabilities();
        logger.info('Model capabilities:', this.capabilities);
      } catch (error) {
        logger.error('Failed to get capabilities:', error);
      }
    }
  }

  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    await this.ensureInitialized();

    const hasTools = !!(options?.tools?.length);
    const opts = mapOptions(this.defaultOptions, options);

    if (hasTools) {
      // ツールあり: JSON レスポンスモード（Python 側でパース済み）
      opts.tools = convertToolDefinitions(options!.tools!);
      const messages = formatPromptAsMessages(prompt, this.formatterOptions);
      const result = await this.process.chatWithTools(convertMessages(messages), opts);

      const toolCalls: ToolCall[] | undefined = result.tool_calls?.length
        ? result.tool_calls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }))
        : undefined;

      let structuredOutput: unknown | undefined;
      if (prompt.metadata?.outputSchema && result.content) {
        const extracted = extractJSON(result.content, { multiple: false });
        if (extracted.source !== 'none' && extracted.data !== null) {
          structuredOutput = extracted.data;
        }
      }

      const finishReason: FinishReason = toolCalls ? 'tool_calls' : 'stop';
      return { content: result.content, structuredOutput, toolCalls, finishReason };
    }

    // ツールなし: ストリーミングモード
    const { stream, result } = await this.streamQuery(prompt, options);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) { /* consume */ }
    return result;
  }

  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
    await this.ensureInitialized();

    const opts = mapOptions(this.defaultOptions, options);
    const messages = formatPromptAsMessages(prompt, this.formatterOptions);
    const stream = await this.process.chatStream(convertMessages(messages), opts);
    const { iterable, completion } = createStreamIterable(stream);

    const resultPromise = completion.then(({ content, error }) => {
      if (error) throw error;

      let structuredOutput: unknown | undefined;
      if (prompt.metadata?.outputSchema && content) {
        const extracted = extractJSON(content, { multiple: false });
        if (extracted.source !== 'none' && extracted.data !== null) {
          structuredOutput = extracted.data;
        }
      }

      return { content, finishReason: 'stop' as FinishReason, structuredOutput };
    });

    return { stream: iterable, result: resultPromise };
  }

  async close(): Promise<void> {
    await this.process.close();
  }
}
