/**
 * Local Inference Protocol プロセスクライアント
 *
 * stdio JSON-RPC 通信とリクエストキューを統合する。
 */

import { Readable } from 'stream';
import { Logger } from '@modular-prompt/utils';
import type { RuntimeProfile } from '../runtime/index.js';
import { assertRuntimeReady } from '../runtime/index.js';
import type {
  InferenceCapabilities,
  InferenceFormatTestResult,
  InferenceRenderResult,
  InferenceTokenizeResult,
  InferenceCachePrefillResult,
  InferenceMessage,
  InferenceToolDefinition,
} from './protocol.js';
import {
  ProcessCommunication,
  type ProcessCommunicationCallbacks,
} from './process-communication.js';
import {
  InferenceRequestQueue,
  type RequestQueueCallbacks,
  type SamplingOptionsMapper,
} from './request-queue.js';

export interface InferenceProcessClientConfig {
  modelName: string;
  /** uv --project に渡す Python プロジェクトディレクトリ */
  pythonProjectDir: string;
  /** UV_PROJECT_ENVIRONMENT に設定する venv パス */
  venvPath: string;
  /** 指定時は起動前に runtime venv の存在を確認する */
  runtimeProfile?: RuntimeProfile;
  extraSpawnArgs?: string[];
  loggerPrefix?: string;
  mapSamplingOptions?: SamplingOptionsMapper;
  processExitErrorMessage?: (code: number | null, signal: string | null) => string;
}

export class InferenceProcessClient {
  readonly modelName: string;

  private requestQueue: InferenceRequestQueue;
  private processComm: ProcessCommunication;

  constructor(config: InferenceProcessClientConfig) {
    this.modelName = config.modelName;

    if (config.runtimeProfile) {
      assertRuntimeReady(config.runtimeProfile);
    }

    const logger = new Logger({
      prefix: config.loggerPrefix ?? 'LIP',
      context: 'process',
    });

    // processCallbacks は this.requestQueue 代入前に定義するが、
    // コールバックは子プロセスの stdout/exit など非同期イベント時のみ呼ばれるため安全。
    const processCallbacks: ProcessCommunicationCallbacks = {
      onJsonResponse: (jsonData) => this.requestQueue.handleJsonResponse(jsonData),
      onRequestCompleted: () => this.requestQueue.onRequestCompleted(),
      onProcessExit: (code, signal) => {
        if (code !== 0) {
          const message =
            config.processExitErrorMessage?.(code, signal) ??
            `Inference process exited unexpectedly (code=${code}, signal=${signal})`;
          logger.error(message);
          this.requestQueue.rejectAll(new Error(message));
        }
      },
    };

    const queueCallbacks: RequestQueueCallbacks = {
      sendToProcess: (data) => this.processComm.sendToProcess(data),
      createNewStream: () => this.processComm.createNewStream(),
      cancelActiveStream: () => this.processComm.cancelActiveStream(),
    };

    this.processComm = new ProcessCommunication(
      {
        pythonProjectDir: config.pythonProjectDir,
        venvPath: config.venvPath,
        modelName: config.modelName,
        extraArgs: config.extraSpawnArgs,
        loggerPrefix: config.loggerPrefix,
        processExitErrorMessage: config.processExitErrorMessage,
      },
      processCallbacks,
    );

    this.requestQueue = new InferenceRequestQueue(queueCallbacks, config.mapSamplingOptions);
  }

  async ensureInitialized(): Promise<void> {
    // 互換性のため維持
  }

  async getCapabilities(): Promise<InferenceCapabilities> {
    return this.requestQueue.addCapabilitiesRequest();
  }

  async formatTest(
    messages: InferenceMessage[],
    options?: { primer?: string },
  ): Promise<InferenceFormatTestResult> {
    return this.requestQueue.addFormatTestRequest(messages, options);
  }

  async render(
    messages: InferenceMessage[],
    options?: unknown,
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceRenderResult> {
    return this.requestQueue.addRenderRequest(
      messages,
      options as Parameters<InferenceRequestQueue['addRenderRequest']>[1],
      tools,
      reasoningEffort,
    );
  }

  async tokenize(
    messages: InferenceMessage[],
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceTokenizeResult> {
    return this.requestQueue.addTokenizeRequest(messages, tools, reasoningEffort);
  }

  async cachePrefill(
    cachePath: string,
    messages: InferenceMessage[],
    baseCachePath?: string,
    trimToTokens?: number,
    prefixOffsets?: number[],
    prefixHashes?: string[],
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceCachePrefillResult> {
    return this.requestQueue.addCachePrefillRequest(
      cachePath,
      messages,
      baseCachePath,
      trimToTokens,
      prefixOffsets,
      prefixHashes,
      tools,
      reasoningEffort,
    );
  }

  async completion(
    prompt: string,
    options?: unknown,
    images?: string[],
    maxImageSize?: number,
  ): Promise<Readable> {
    return this.requestQueue.addCompletionRequest(prompt, options, images, maxImageSize);
  }

  async generate(
    prompt: string | number[],
    options?: unknown,
    images?: string[],
    maxImageSize?: number,
    cachePath?: string,
    cacheTrimTokens?: number,
    primer?: string,
  ): Promise<Readable> {
    return this.requestQueue.addGenerateRequest(
      prompt,
      options,
      images,
      maxImageSize,
      cachePath,
      cacheTrimTokens,
      primer,
    );
  }

  async exit(): Promise<void> {
    await this.processComm.exit();
  }

  cancelActiveRequest(): void {
    this.requestQueue.cancelActiveRequest();
  }

  getStatus() {
    return {
      modelName: this.modelName,
      queueLength: this.requestQueue.length,
      isStreamingActive: this.processComm.isStreamingActive(),
      isJsonBuffering: this.processComm.isJsonBuffering(),
    };
  }
}
