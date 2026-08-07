/**
 * LIP JSON-RPC リクエストキュー
 */

import { Readable } from 'stream';
import type {
  InferenceCapabilities,
  InferenceCapabilitiesRequest,
  InferenceFormatTestRequest,
  InferenceFormatTestResult,
  InferenceTokenizeRequest,
  InferenceTokenizeResult,
  InferenceChatRequest,
  InferenceCompletionRequest,
  InferenceGenerateRequest,
  InferenceCachePrefillRequest,
  InferenceCachePrefillResult,
  InferenceMessage,
  InferenceToolDefinition,
  InferenceSamplingOptions,
} from './protocol.js';
import type {
  QueueItem,
  CapabilitiesQueueItem,
  FormatTestQueueItem,
  TokenizeQueueItem,
  CachePrefillQueueItem,
  StreamingQueueItem,
} from './queue-types.js';

export interface RequestQueueCallbacks {
  sendToProcess: (data: string) => void;
  createNewStream: () => Readable;
  cancelActiveStream: () => void;
}

export type SamplingOptionsMapper = (
  options?: unknown,
) => InferenceSamplingOptions | Record<string, unknown> | undefined;

export class InferenceRequestQueue {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private callbacks: RequestQueueCallbacks;
  private mapSamplingOptions: SamplingOptionsMapper;

  constructor(callbacks: RequestQueueCallbacks, mapSamplingOptions?: SamplingOptionsMapper) {
    this.callbacks = callbacks;
    this.mapSamplingOptions = mapSamplingOptions ?? ((options) => options as InferenceSamplingOptions | undefined);
  }

  addCapabilitiesRequest(): Promise<InferenceCapabilities> {
    return new Promise((resolve, reject) => {
      const request: InferenceCapabilitiesRequest = { method: 'capabilities' };
      this.queue.push({
        request,
        resolve,
        reject,
        expectJsonResponse: true,
      } as CapabilitiesQueueItem);
      this.processNext();
    });
  }

  addFormatTestRequest(
    messages: InferenceMessage[],
    options?: { primer?: string },
  ): Promise<InferenceFormatTestResult> {
    return new Promise((resolve, reject) => {
      const request: InferenceFormatTestRequest = {
        method: 'format_test',
        messages,
        options,
      };
      this.queue.push({
        request,
        resolve,
        reject,
        expectJsonResponse: true,
      } as FormatTestQueueItem);
      this.processNext();
    });
  }

  addTokenizeRequest(
    messages: InferenceMessage[],
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceTokenizeResult> {
    return new Promise((resolve, reject) => {
      const request: InferenceTokenizeRequest = {
        method: 'tokenize',
        messages,
        ...(tools && { tools }),
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      };
      this.queue.push({
        request,
        resolve,
        reject,
        expectJsonResponse: true,
      } as TokenizeQueueItem);
      this.processNext();
    });
  }

  addChatRequest(
    messages: InferenceMessage[],
    primer?: string,
    options?: unknown,
    tools?: InferenceToolDefinition[],
    images?: string[],
    maxImageSize?: number,
    reasoningEffort?: 'low' | 'medium' | 'high',
    cachePath?: string,
    cacheTrimTokens?: number,
  ): Promise<Readable> {
    return new Promise((resolve, reject) => {
      try {
        const request: InferenceChatRequest = {
          method: 'chat',
          messages,
          primer,
          tools,
          options: this.mapSamplingOptions(options),
          ...(images?.length ? { images, maxImageSize } : {}),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          ...(cachePath ? { cache_path: cachePath } : {}),
          ...(cacheTrimTokens != null ? { cache_trim_tokens: cacheTrimTokens } : {}),
        };
        this.queue.push({
          request,
          resolve,
          reject,
        } as StreamingQueueItem);
        this.processNext();
      } catch (error) {
        reject(error);
      }
    });
  }

  addCachePrefillRequest(
    cachePath: string,
    messages: InferenceMessage[],
    baseCachePath?: string,
    trimToTokens?: number,
    prefixOffsets?: number[],
    prefixHashes?: string[],
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceCachePrefillResult> {
    return new Promise((resolve, reject) => {
      const request: InferenceCachePrefillRequest = {
        method: 'cache_prefill',
        cache_path: cachePath,
        messages,
        ...(baseCachePath && { base_cache_path: baseCachePath }),
        ...(trimToTokens != null && { trim_to_tokens: trimToTokens }),
        ...(prefixOffsets && prefixHashes && { prefix_offsets: prefixOffsets, prefix_hashes: prefixHashes }),
        ...(tools && { tools }),
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      };
      this.queue.push({
        request,
        resolve,
        reject,
        expectJsonResponse: true,
      } as CachePrefillQueueItem);
      this.processNext();
    });
  }

  addCompletionRequest(
    prompt: string,
    options?: unknown,
    images?: string[],
    maxImageSize?: number,
  ): Promise<Readable> {
    return new Promise((resolve, reject) => {
      try {
        const request: InferenceCompletionRequest = {
          method: 'completion',
          prompt,
          options: this.mapSamplingOptions(options),
          ...(images?.length ? { images, maxImageSize } : {}),
        };
        this.queue.push({
          request,
          resolve,
          reject,
        } as StreamingQueueItem);
        this.processNext();
      } catch (error) {
        reject(error);
      }
    });
  }

  addGenerateRequest(
    prompt: string | number[],
    options?: unknown,
    images?: string[],
    maxImageSize?: number,
  ): Promise<Readable> {
    return new Promise((resolve, reject) => {
      try {
        const request: InferenceGenerateRequest = {
          method: 'generate',
          prompt,
          options: this.mapSamplingOptions(options),
          ...(images?.length ? { images, maxImageSize } : {}),
        };
        this.queue.push({
          request,
          resolve,
          reject,
        } as StreamingQueueItem);
        this.processNext();
      } catch (error) {
        reject(error);
      }
    });
  }

  processNext(): void {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const queueItem = this.queue[0];
    const { request, expectJsonResponse } = queueItem;

    if (!expectJsonResponse) {
      const stream = this.callbacks.createNewStream();
      queueItem.resolve(stream);
      this.queue.shift();
    }

    const input = JSON.stringify(request);
    this.callbacks.sendToProcess(input + '\n');
  }

  handleJsonResponse(jsonData: string): void {
    if (this.queue.length > 0) {
      const queueItem = this.queue.shift();
      if (queueItem?.expectJsonResponse) {
        try {
          const jsonResponse = JSON.parse(jsonData);
          if (queueItem.request.method === 'format_test') {
            if ('template_applied' in jsonResponse) {
              (queueItem as FormatTestQueueItem).resolve(jsonResponse);
            } else {
              (queueItem as FormatTestQueueItem).resolve({
                formatted_prompt: null,
                template_applied: false,
                model_specific_processing: null,
                error: jsonResponse.error || 'Malformed format_test response',
              });
            }
          } else if (queueItem.request.method === 'tokenize') {
            if ('token_count' in jsonResponse) {
              (queueItem as TokenizeQueueItem).resolve(jsonResponse);
            } else {
              (queueItem as TokenizeQueueItem).resolve({
                token_ids: null,
                token_count: 0,
                error: jsonResponse.error || 'Malformed tokenize response',
              });
            }
          } else if (jsonResponse.error) {
            queueItem.reject?.(new Error(jsonResponse.error));
          } else if (queueItem.request.method === 'capabilities') {
            (queueItem as CapabilitiesQueueItem).resolve(jsonResponse);
          } else if (queueItem.request.method === 'cache_prefill') {
            (queueItem as CachePrefillQueueItem).resolve(jsonResponse);
          }
        } catch (e) {
          if (queueItem.request.method === 'capabilities') {
            (queueItem as CapabilitiesQueueItem).resolve({
              methods: [],
              special_tokens: {},
              features: { apply_chat_template: false },
            });
          } else if (queueItem.request.method === 'format_test') {
            (queueItem as FormatTestQueueItem).resolve({
              formatted_prompt: null,
              template_applied: false,
              model_specific_processing: null,
              error: e instanceof Error ? e.message : 'Unknown error',
            });
          } else if (queueItem.request.method === 'tokenize') {
            (queueItem as TokenizeQueueItem).resolve({
              token_ids: null,
              token_count: 0,
              error: e instanceof Error ? e.message : 'Unknown error',
            });
          } else if (queueItem.request.method === 'cache_prefill') {
            (queueItem as CachePrefillQueueItem).reject(
              e instanceof Error ? e : new Error(String(e)),
            );
          }
        }
      }
    }
  }

  onRequestCompleted(): void {
    this.isProcessing = false;
    this.processNext();
  }

  cancelActiveRequest(): void {
    if (!this.isProcessing) {
      return;
    }
    this.callbacks.cancelActiveStream();
  }

  get length(): number {
    return this.queue.length;
  }

  rejectAll(error: Error): void {
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.reject?.(error);
    }
    this.isProcessing = false;
  }
}
