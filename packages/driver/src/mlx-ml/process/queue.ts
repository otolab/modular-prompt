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
  StreamingQueueItem,
  MlxCapabilitiesRequest,
  MlxFormatTestRequest,
  MlxChatRequest,
  MlxCompletionRequest,
  MlxMessage,
  MlxMlModelOptions,
  MlxRuntimeInfo,
  MlxFormatTestResult,
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
    return new Promise((resolve) => {
      const request: MlxCapabilitiesRequest = { method: 'capabilities' };
      this.queue.push({ 
        request, 
        resolve, 
        expectJsonResponse: true 
      } as CapabilitiesQueueItem);
      this.processNext();
    });
  }

  addFormatTestRequest(messages: MlxMessage[], options?: { primer?: string }): Promise<MlxFormatTestResult> {
    return new Promise((resolve) => {
      const request: MlxFormatTestRequest = { 
        method: 'format_test', 
        messages, 
        options 
      };
      this.queue.push({ 
        request, 
        resolve, 
        expectJsonResponse: true 
      } as FormatTestQueueItem);
      this.processNext();
    });
  }

  addChatRequest(messages: MlxMessage[], primer?: string, options?: MlxMlModelOptions, tools?: MlxToolDefinition[]): Promise<Readable> {
    return new Promise((resolve, reject) => {
      try {
        const request: MlxChatRequest = {
          method: 'chat',
          messages,
          primer,
          tools,
          options: mapOptionsToPython(options, true)  // strict mode: true
        };
        this.queue.push({
          request,
          resolve
        } as StreamingQueueItem);
        this.processNext();
      } catch (error) {
        reject(error);
      }
    });
  }

  addCompletionRequest(prompt: string, options?: MlxMlModelOptions): Promise<Readable> {
    return new Promise((resolve, reject) => {
      try {
        const request: MlxCompletionRequest = {
          method: 'completion',
          prompt,
          options: mapOptionsToPython(options, true)  // strict mode: true
        };
        this.queue.push({
          request,
          resolve
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
          }
        } catch (e) {
          // エラー時のフォールバック処理
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
          }
        }
      }
    }
    this.isProcessing = false;
    this.processNext(); // 次のリクエストを処理
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

  clear(): void {
    this.queue = [];
    this.isProcessing = false;
  }
}