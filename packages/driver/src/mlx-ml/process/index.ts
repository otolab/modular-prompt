/**
 * MLX Driver 外部インターフェース
 * 
 * mlx-ml.tsドライバーからアクセスされるメイン API
 * 機能をモジュール化し、役割を分離
 */

import { Readable } from 'stream';
import { Logger } from '@modular-prompt/utils';
import type {
  MlxMlModelOptions,
  MlxMessage,
  MlxRuntimeInfo,
  MlxFormatTestResult,
  MlxCachePrefillResult,
  MlxToolDefinition
} from './types.js';
import { QueueManager, QueueManagerCallbacks } from './queue.js';
import { ProcessCommunication, ProcessCommunicationCallbacks } from './process-communication.js';

const logger = new Logger({ prefix: 'MLX', context: 'process' });

// API v2.0 型をエクスポート
export type {
  MlxMlModelOptions,
  MlxMessage,
  MlxRuntimeInfo,
  MlxFormatTestResult,
  MlxCachePrefillResult,
  MlxToolDefinition
};

export interface MlxProcessOptions {
  textOnly?: boolean;
  drafterModel?: string;
}

export class MlxProcess {
  modelName: string;

  private queueManager: QueueManager;
  private processComm: ProcessCommunication;

  constructor(modelName: string, options?: MlxProcessOptions) {
    this.modelName = modelName;

    // コールバック設定
    const processCallbacks: ProcessCommunicationCallbacks = {
      onJsonResponse: (jsonData: string) => this.queueManager.handleJsonResponse(jsonData),
      onRequestCompleted: () => this.queueManager.onRequestCompleted(),
      onProcessExit: (code: number | null, signal: string | null) => {
        if (code !== 0) {
          const error = new Error(
            `MLX process exited unexpectedly (code=${code}, signal=${signal})`
          );
          logger.error(error.message);
          this.queueManager.rejectAll(error);
        }
      },
    };

    const queueCallbacks: QueueManagerCallbacks = {
      sendToProcess: (data: string) => this.processComm.sendToProcess(data),
      createNewStream: () => this.processComm.createNewStream()
    };

    // 各コンポーネント初期化
    this.processComm = new ProcessCommunication(modelName, processCallbacks, options);
    this.queueManager = new QueueManager(queueCallbacks);
  }

  /**
   * 初期化（何もしない - 互換性のために残す）
   */
  async ensureInitialized(): Promise<void> {
    // No-op for compatibility
  }

  // API v2.0 Capabilities
  async getCapabilities(): Promise<MlxRuntimeInfo> {
    return this.queueManager.addCapabilitiesRequest();
  }

  // API v2.0 Format Test
  async formatTest(messages: MlxMessage[], options?: { primer?: string }): Promise<MlxFormatTestResult> {
    return this.queueManager.addFormatTestRequest(messages, options);
  }

  // Cache operations
  async cachePrefill(cachePath: string, messages: MlxMessage[]): Promise<MlxCachePrefillResult> {
    return this.queueManager.addCachePrefillRequest(cachePath, messages);
  }

  // API v2.0 Chat
  async chat(messages: MlxMessage[], primer?: string, options?: MlxMlModelOptions, tools?: MlxToolDefinition[], images?: string[], maxImageSize?: number, reasoningEffort?: 'low' | 'medium' | 'high', cachePath?: string): Promise<Readable> {
    return this.queueManager.addChatRequest(messages, primer, options, tools, images, maxImageSize, reasoningEffort, cachePath);
  }

  // API v2.0 Completion
  async completion(prompt: string, options?: MlxMlModelOptions, images?: string[], maxImageSize?: number): Promise<Readable> {
    return this.queueManager.addCompletionRequest(prompt, options, images, maxImageSize);
  }


  async exit(): Promise<void> {
    await this.processComm.exit();
  }

  // デバッグ・ステータス情報
  getStatus() {
    return {
      modelName: this.modelName,
      queueLength: this.queueManager.length,
      isStreamingActive: this.processComm.isStreamingActive(),
      isJsonBuffering: this.processComm.isJsonBuffering()
    };
  }
}