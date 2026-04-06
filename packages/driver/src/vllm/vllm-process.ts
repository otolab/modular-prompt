/**
 * vLLM Unix ソケット通信
 *
 * 独立して起動された vLLM エンジンプロセスに Unix ドメインソケットで接続。
 * エンジンの起動・停止はドライバーの責任外。
 *
 * プロトコル:
 * - リクエスト: JSON + 改行
 * - レスポンス:
 *   - ストリーミング: テキストを逐次受信、null文字(\0)で終端
 *   - JSON: JSON 文字列を受信、null文字(\0)で終端
 */

import net from 'net';
import { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'vLLM', context: 'process' });

export interface VllmCapabilities {
  model: string;
  has_chat_template: boolean;
  max_model_len: number;
  tool_call_parser: string | null;
}

export interface VllmChatResult {
  content: string;
  tool_calls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// Queue item types
// ---------------------------------------------------------------------------

interface BaseQueueItem {
  request: Record<string, unknown>;
}

interface JsonQueueItem extends BaseQueueItem {
  expectJson: true;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface StreamingQueueItem extends BaseQueueItem {
  expectJson: false;
  resolve: (value: Readable) => void;
  reject: (error: Error) => void;
}

type QueueItem = JsonQueueItem | StreamingQueueItem;

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

export class VllmProcess {
  private socketPath: string;
  private socket: net.Socket | null = null;
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private currentStream: Readable | null = null;
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private connectPromise: Promise<void> | null = null;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;

    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath, () => {
        logger.info(`Connected to vLLM engine: ${this.socketPath}`);
        this.socket = socket;
        this.connectPromise = null;
        resolve();
      });

      socket.on('error', (err) => {
        this.connectPromise = null;
        if (!this.socket) {
          reject(new Error(`Failed to connect to vLLM engine at ${this.socketPath}: ${err.message}`));
        } else {
          logger.error('Socket error:', err);
          this.handleDisconnect();
        }
      });

      socket.on('close', () => {
        logger.info('Socket closed');
        this.handleDisconnect();
      });

      socket.on('data', (data: Buffer) => {
        this.handleData(data);
      });
    });

    return this.connectPromise;
  }

  private handleDisconnect(): void {
    this.socket = null;
    this.isProcessing = false;

    if (this.currentStream) {
      this.currentStream.push(null);
      this.currentStream = null;
    }

    // 残っているキューアイテムをエラーで reject
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.reject(new Error('Connection to vLLM engine lost'));
    }
  }

  private handleData(data: Buffer): void {
    const nullIndex = data.indexOf(0); // \0

    if (nullIndex !== -1) {
      const chunk = this.decoder.write(data.slice(0, nullIndex));
      this.decoder = new StringDecoder('utf8');

      if (this.currentStream) {
        if (chunk) this.currentStream.push(chunk);
        this.currentStream.push(null);
        this.currentStream = null;
      } else {
        this.buffer += chunk;
        this.handleJsonResponse(this.buffer);
        this.buffer = '';
      }

      this.isProcessing = false;

      // null文字以降のデータがあれば次のレスポンスとして処理
      const remaining = data.slice(nullIndex + 1);
      if (remaining.length > 0) {
        this.processNext();
        this.handleData(remaining);
      } else {
        this.processNext();
      }
    } else {
      const chunk = this.decoder.write(data);
      if (this.currentStream) {
        this.currentStream.push(chunk);
      } else {
        this.buffer += chunk;
      }
    }
  }

  private handleJsonResponse(data: string): void {
    if (this.queue.length === 0) return;
    const item = this.queue.shift()!;
    if (item.expectJson) {
      try {
        item.resolve(JSON.parse(data));
      } catch {
        item.resolve({});
      }
    }
  }

  private processNext(): void {
    if (this.isProcessing || this.queue.length === 0 || !this.socket) return;

    this.isProcessing = true;
    const item = this.queue[0];

    if (!item.expectJson) {
      const stream = new Readable({ read() {} });
      this.currentStream = stream;
      (item as StreamingQueueItem).resolve(stream);
      this.queue.shift();
    }

    this.socket.write(JSON.stringify(item.request) + '\n');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async getCapabilities(): Promise<VllmCapabilities> {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      this.queue.push({
        request: { method: 'capabilities' },
        expectJson: true,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.processNext();
    });
  }

  /**
   * Chat (streaming) — tools なし
   */
  async chatStream(
    messages: Array<Record<string, unknown>>,
    options?: Record<string, unknown>
  ): Promise<Readable> {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      this.queue.push({
        request: { method: 'chat', messages, options },
        expectJson: false,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.processNext();
    });
  }

  /**
   * Chat (JSON) — tools あり。Python 側でツールパースし結果を返す
   */
  async chatWithTools(
    messages: Array<Record<string, unknown>>,
    options: Record<string, unknown>
  ): Promise<VllmChatResult> {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      this.queue.push({
        request: { method: 'chat', messages, options },
        expectJson: true,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.processNext();
    });
  }

  /**
   * Completion (streaming)
   */
  async completion(prompt: string, options?: Record<string, unknown>): Promise<Readable> {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      this.queue.push({
        request: { method: 'completion', prompt, options },
        expectJson: false,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.processNext();
    });
  }

  async close(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
