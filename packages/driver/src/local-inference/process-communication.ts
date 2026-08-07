/**
 * Thin Python 推論プロセスとの stdio 通信
 */

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import { Logger } from '@modular-prompt/utils';

export interface ProcessCommunicationCallbacks {
  onJsonResponse: (jsonData: string) => void;
  onRequestCompleted: () => void;
  onProcessExit: (code: number | null, signal: string | null) => void;
}

export interface ProcessCommunicationConfig {
  /** uv --project に渡す Python プロジェクトディレクトリ */
  pythonProjectDir: string;
  /** UV_PROJECT_ENVIRONMENT に設定する venv パス */
  venvPath: string;
  modelName: string;
  /** `__main__.py` と modelName の後に付与する追加引数 */
  extraArgs?: string[];
  loggerPrefix?: string;
  loggerContext?: string;
  processExitErrorMessage?: (code: number | null, signal: string | null) => string;
}

export class ProcessCommunication {
  private process: ChildProcessWithoutNullStreams;
  private decoder: StringDecoder;
  private currentStream: Readable | null = null;
  private jsonBuffer: string = '';
  private draining = false;
  private callbacks: ProcessCommunicationCallbacks;
  private readonly exitErrorMessage: (code: number | null, signal: string | null) => string;

  constructor(config: ProcessCommunicationConfig, callbacks: ProcessCommunicationCallbacks) {
    this.callbacks = callbacks;
    this.decoder = new StringDecoder('utf8');
    this.exitErrorMessage =
      config.processExitErrorMessage ??
      ((code, signal) => `Inference process exited unexpectedly (code=${code}, signal=${signal})`);

    const logger = new Logger({
      prefix: config.loggerPrefix ?? 'LIP',
      context: config.loggerContext ?? 'process',
    });

    const args = [
      '--project',
      config.pythonProjectDir,
      'run',
      'python',
      '__main__.py',
      config.modelName,
      ...(config.extraArgs ?? []),
    ];

    this.process = spawn('uv', args, {
      cwd: config.pythonProjectDir,
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: config.venvPath,
      },
    });

    this.process.stderr.on('data', (data) => {
      logger.debug(data.toString());
    });

    this.process.stdout.on('data', (data) => {
      this.processData(data);
    });

    this.process.on('error', (err) => {
      logger.error('Child process error:', err);
    });

    this.process.on('exit', (code, signal) => {
      if (this.currentStream) {
        this.currentStream.destroy(new Error(this.exitErrorMessage(code, signal)));
        this.currentStream = null;
      }
      this.callbacks.onProcessExit(code, signal);
    });
  }

  private processData(data: Buffer): void {
    let remaining: Buffer = data;

    while (remaining.length > 0) {
      const nullIndex = remaining.indexOf('\0');

      if (nullIndex !== -1) {
        const chunk = this.decoder.write(remaining.slice(0, nullIndex));
        this.decoder = new StringDecoder('utf8');

        if (this.currentStream) {
          this.currentStream.push(chunk);
          this.currentStream.push(null);
          this.currentStream = null;
        } else if (!this.draining) {
          this.jsonBuffer += chunk;
          this.callbacks.onJsonResponse(this.jsonBuffer);
          this.jsonBuffer = '';
        }

        this.callbacks.onRequestCompleted();

        if (this.draining) {
          this.draining = false;
        }

        remaining = remaining.slice(nullIndex + 1);
      } else {
        const chunk = this.decoder.write(remaining);

        if (this.currentStream) {
          this.currentStream.push(chunk);
        } else if (!this.draining) {
          this.jsonBuffer += chunk;
        }
        break;
      }
    }
  }

  createNewStream(): Readable {
    this.currentStream = new Readable({
      read() {},
    });
    return this.currentStream;
  }

  cancelActiveStream(): void {
    if (!this.currentStream && !this.draining) {
      return;
    }

    if (this.currentStream) {
      this.currentStream.destroy();
      this.currentStream = null;
    }

    this.draining = true;
    this.sendToProcess(JSON.stringify({ method: 'cancel' }) + '\n');
  }

  sendToProcess(data: string): void {
    this.process.stdin.write(data);
  }

  isStreamingActive(): boolean {
    return this.currentStream !== null;
  }

  isJsonBuffering(): boolean {
    return this.jsonBuffer.length > 0;
  }

  async exit(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.process.kill('SIGTERM');
        resolve();
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.process.stdin.end();
    });
  }
}
