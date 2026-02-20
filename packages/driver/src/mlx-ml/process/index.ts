/**
 * MLX Driver 外部インターフェース
 * 
 * mlx-ml.tsドライバーからアクセスされるメイン API
 * 機能をモジュール化し、役割を分離
 */

import { Readable } from 'stream';
import type {
  MlxMlModelOptions,
  MlxMessage,
  MlxRuntimeInfo,
  MlxFormatTestResult,
  MlxToolDefinition
} from './types.js';
import { QueueManager, QueueManagerCallbacks } from './queue.js';
import { ProcessCommunication, ProcessCommunicationCallbacks } from './process-communication.js';

// API v2.0 型をエクスポート
export type {
  MlxMlModelOptions,
  MlxMessage,
  MlxRuntimeInfo,
  MlxFormatTestResult,
  MlxToolDefinition
};

export class MlxProcess {
  modelName: string;

  private queueManager: QueueManager;
  private processComm: ProcessCommunication;

  constructor(modelName: string) {
    this.modelName = modelName;

    // コールバック設定
    const processCallbacks: ProcessCommunicationCallbacks = {
      onJsonResponse: (jsonData: string) => this.queueManager.handleJsonResponse(jsonData),
      onRequestCompleted: () => this.queueManager.onRequestCompleted()
    };

    const queueCallbacks: QueueManagerCallbacks = {
      sendToProcess: (data: string) => this.processComm.sendToProcess(data),
      createNewStream: () => this.processComm.createNewStream()
    };

    // 各コンポーネント初期化
    this.processComm = new ProcessCommunication(modelName, processCallbacks);
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

  // API v2.0 Chat - chat APIを直接使用
  async chat(messages: MlxMessage[], primer?: string, options?: MlxMlModelOptions, tools?: MlxToolDefinition[]): Promise<Readable> {
    // chat APIを直接使用（前処理はドライバーで実施済み）
    return this.queueManager.addChatRequest(messages, primer, options, tools);
  }

  // API v2.0 Completion - completion APIを直接使用
  async completion(prompt: string, options?: MlxMlModelOptions): Promise<Readable> {
    // completion APIを直接使用（前処理はドライバーで実施済み）
    return this.queueManager.addCompletionRequest(prompt, options);
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