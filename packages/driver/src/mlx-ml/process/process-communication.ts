/**
 * MLX Driver プロセス通信管理
 * 
 * Pythonプロセスとの通信、データの送受信、ストリーミング処理を管理
 */

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import path from "path";
import { fileURLToPath } from "url";
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'MLX', context: 'process' });

// Get the mlx-ml/python directory
// From dist/mlx-ml/process/ -> go up 3 levels to package root, then to src/mlx-ml/python
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..'  // dist/mlx-ml/process -> dist/mlx-ml -> dist -> package root
);

const mlxDriverDir = path.join(
  packageRoot,
  'src', 'mlx-ml', 'python'
);

export interface ProcessCommunicationCallbacks {
  onJsonResponse: (jsonData: string) => void;
  onRequestCompleted: () => void;
}

export class ProcessCommunication {
  private process: ChildProcessWithoutNullStreams;
  private decoder: StringDecoder;
  private currentStream: Readable | null = null;
  private jsonBuffer: string = '';
  private callbacks: ProcessCommunicationCallbacks;

  constructor(modelName: string, callbacks: ProcessCommunicationCallbacks) {
    this.callbacks = callbacks;
    this.decoder = new StringDecoder('utf8');

    this.process = spawn('uv', [
      '--project',
      mlxDriverDir,
      'run',
      'python',
      '__main__.py',
      modelName
    ], {
      cwd: mlxDriverDir
    });

    this.setupProcessHandlers();
  }

  private setupProcessHandlers(): void {
    this.process.stderr.on('data', (data) => {
      logger.debug(data.toString());
    });

    this.process.stdout.on('data', (data) => {
      // ここはnull文字でなくてはならない
      const nullIndex = data.indexOf('\0');
      
      if (nullIndex !== -1) {
        // null文字が見つかった場合、レスポンス終了
        const chunk = this.decoder.write(data.slice(0, nullIndex));
        this.decoder = new StringDecoder('utf8');
        
        if (this.currentStream) {
          // ストリーミングレスポンスの場合
          this.currentStream.push(chunk);
          this.currentStream.push(null); // ストリーム終了
          this.currentStream = null;
        } else {
          // JSONレスポンスの場合
          this.jsonBuffer += chunk;
          this.callbacks.onJsonResponse(this.jsonBuffer);
          this.jsonBuffer = '';
        }
        
        this.callbacks.onRequestCompleted();
      } else {
        // null文字がない場合、データを蓄積
        const chunk = this.decoder.write(data);
        
        if (this.currentStream) {
          // ストリーミング中
          this.currentStream.push(chunk);
        } else {
          // JSONレスポンス蓄積中
          this.jsonBuffer += chunk;
        }
      }
    });

    this.process.on('error', (err) => {
      logger.error('Child process error:', err);
    });
  }

  createNewStream(): Readable {
    this.currentStream = new Readable({
      read() {} // 空のreadメソッド
    });
    return this.currentStream;
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
        // タイムアウト後は強制終了
        this.process.kill('SIGTERM');
        resolve();
      }, 5000); // 5秒でタイムアウト

      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // stdinを閉じてプロセスに終了を通知
      this.process.stdin.end();
    });
  }
}