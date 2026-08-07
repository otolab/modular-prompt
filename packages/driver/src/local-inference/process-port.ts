import type { Readable } from 'stream';
import type {
  InferenceCapabilities,
  InferenceMessage,
  InferenceRenderResult,
  InferenceToolDefinition,
} from './protocol.js';

/** LIP プロセスへの最小ポート（MlxProcess / 将来 PyTorchProcess が実装） */
export interface InferenceProcessPort {
  ensureInitialized(): Promise<void>;
  getCapabilities(): Promise<InferenceCapabilities>;
  render(
    messages: InferenceMessage[],
    options?: Record<string, unknown>,
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceRenderResult>;
  generate(
    prompt: string | number[],
    options?: Record<string, unknown>,
    images?: string[],
    maxImageSize?: number,
    cachePath?: string,
    cacheTrimTokens?: number,
    primer?: string,
  ): Promise<Readable>;
  cancelActiveRequest(): void;
  exit(): Promise<void>;
}
