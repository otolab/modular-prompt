/**
 * MLX Driver キュー管理システム
 *
 * リクエストキューの管理とプロセッシングロジックを提供
 */

import { Readable } from 'stream';
import { mapOptionsToPython } from './parameter-mapper.js';
import type {
  QueueItem,
  CapabilitiesQueueItem,
  FormatTestQueueItem,
  CachePrefillQueueItem,
  StreamingQueueItem,
  MlxCapabilitiesRequest,
  MlxFormatTestRequest,
  MlxChatRequest,
  MlxCompletionRequest,
  MlxCachePrefillRequest,
  MlxMessage,
  MlxMlModelOptions,
  MlxRuntimeInfo,
  MlxFormatTestResult,
  MlxCachePrefillResult,
  MlxToolDefinition
} from './types.js';

export interface QueueManagerCallbacks {
  sendToProcess: (data: string) => void;
  createNewStream: () => Readable;
}

export class QueueManager {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private callbacks: QueueManagerCallbacks;

  constructor(callbacks: QueueManagerCallbacks) {
    this.callbacks = callbacks;
  }

  addCapabilitiesRequest(): Promise<MlxRuntimeInfo> {
    return new Promise((resolve, reject) => {
      const request: MlxCapabilitiesRequest = { method: 'capabilities' };
      this.queue.push({
        request,
        resolve,
        reject,
        expectJsonResponse: true
      } as CapabilitiesQueueItem);
      this.processNext();
    });
  }

  addFormatTestRequest(messages: MlxMessage[], options?: { primer?: string }): Promise<MlxFormatTestResult> {
    return new Promise((resolve, reject) => {
      const request: MlxFormatTestRequest = {
        method: 'format_test',
        messages,
        options
      };
      this.queue.push({
        request,
        resolve,
        reject,
        expectJsonResponse: true
      } as FormatTestQueueItem);
      this.processNext();
    });
  }

  addChatRequest(messages: MlxMessage[], primer?: string, options?: MlxMlModelOptions, tools?: MlxToolDefinition[], images?: string[], maxImageSize?: number, reasoningEffort?: 'low' | 'medium' | 'high', cachePath?: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
      try {
        const request: MlxChatRequest = {
          method: 'chat',
          messages,
          primer,
          tools,
          options: mapOptionsToPython(options, true),
          ...(images?.length ? { images, maxImageSize } : {}),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          ...(cachePath ? { cache_path: cachePath } : {}),
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

  addCachePrefillRequest(cachePath: string, messages: MlxMessage[]): Promise<MlxCachePrefillResult> {
    return new Promise((resolve, reject) => {
      const request: MlxCachePrefillRequest = {
        method: 'cache_prefill',
        cache_path: cachePath,
        messages,
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

  addCompletionRequest(prompt: string, options?: MlxMlModelOptions, images?: string[], maxImageSize?: number, cachePath?: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
      try {
        const request: MlxCompletionRequest = {
          method: 'completion',
          prompt,
          options: mapOptionsToPython(options, true),
          ...(images?.length ? { images, maxImageSize } : {}),
          ...(cachePath ? { cache_path: cachePath } : {}),
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


  processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const queueItem = this.queue[0]; // まだshiftしない
    const { request, expectJsonResponse } = queueItem;

    // ストリーミングレスポンスの場合のみcurrentStreamを設定
    if (!expectJsonResponse) {
      const stream = this.callbacks.createNewStream();
      queueItem.resolve(stream);
      this.queue.shift(); // ここでshiftする
    }

    // リクエストを送信
    const input = JSON.stringify(request);
    this.callbacks.sendToProcess(input + '\n');
  }

  handleJsonResponse(jsonData: string): void {
    if (this.queue.length > 0) {
      const queueItem = this.queue.shift();
      if (queueItem?.expectJsonResponse) {
        try {
          const jsonResponse = JSON.parse(jsonData);
          if (queueItem.request.method === 'capabilities') {
            (queueItem as CapabilitiesQueueItem).resolve(jsonResponse);
          } else if (queueItem.request.method === 'format_test') {
            (queueItem as FormatTestQueueItem).resolve(jsonResponse);
          } else if (queueItem.request.method === 'cache_prefill') {
            if (jsonResponse.error) {
              (queueItem as CachePrefillQueueItem).reject(new Error(jsonResponse.error));
            } else {
              (queueItem as CachePrefillQueueItem).resolve(jsonResponse);
            }
          }
        } catch (e) {
          if (queueItem.request.method === 'capabilities') {
            (queueItem as CapabilitiesQueueItem).resolve({
              methods: [],
              special_tokens: {},
              features: { apply_chat_template: false }
            });
          } else if (queueItem.request.method === 'format_test') {
            (queueItem as FormatTestQueueItem).resolve({
              formatted_prompt: null,
              template_applied: false,
              model_specific_processing: null,
              error: e instanceof Error ? e.message : 'Unknown error'
            });
          } else if (queueItem.request.method === 'cache_prefill') {
            (queueItem as CachePrefillQueueItem).reject(
              e instanceof Error ? e : new Error(String(e))
            );
          }
        }
      }
    }
  }

  onRequestCompleted(): void {
    this.isProcessing = false;
    this.processNext(); // 次のリクエストを処理
  }

  get length(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  rejectAll(error: Error): void {
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.reject?.(error);
    }
    this.isProcessing = false;
  }

  clear(): void {
    this.queue = [];
    this.isProcessing = false;
  }
}