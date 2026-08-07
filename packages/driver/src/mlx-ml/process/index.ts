/**
 * MLX Driver 外部インターフェース
 *
 * mlx-ml.ts ドライバーからアクセスされるメイン API。
 * 通信層は LIP InferenceProcessClient に委譲する。
 */

import { Readable } from 'stream';
import {
  getMlxPythonDir,
  getVenvPath,
  resolvePackageRootFromProcessModule,
} from '../../runtime/index.js';
import { InferenceProcessClient } from '../../local-inference/process-client.js';
import type {
  MlxMlModelOptions,
  MlxMessage,
  MlxRuntimeInfo,
  MlxFormatTestResult,
  MlxTokenizeResult,
  MlxCachePrefillResult,
  MlxToolDefinition,
} from './types.js';
import { mapOptionsToPython } from './parameter-mapper.js';

const packageRoot = resolvePackageRootFromProcessModule(import.meta.url);
const mlxPythonDir = getMlxPythonDir(packageRoot);
const mlxVenvPath = getVenvPath('mlx');

export type {
  MlxMlModelOptions,
  MlxMessage,
  MlxRuntimeInfo,
  MlxFormatTestResult,
  MlxTokenizeResult,
  MlxCachePrefillResult,
  MlxToolDefinition,
};

export interface MlxProcessOptions {
  textOnly?: boolean;
  drafterModel?: string;
  draftBlockSize?: number;
}

function buildMlxSpawnArgs(options?: MlxProcessOptions): string[] {
  const args: string[] = [];
  if (options?.textOnly) {
    args.push('--text-only');
  }
  if (options?.drafterModel) {
    args.push('--drafter', options.drafterModel);
  }
  if (options?.draftBlockSize !== undefined) {
    args.push('--draft-block-size', options.draftBlockSize.toString());
  }
  return args;
}

export class MlxProcess {
  modelName: string;
  private client: InferenceProcessClient;

  constructor(modelName: string, options?: MlxProcessOptions) {
    this.modelName = modelName;

    this.client = new InferenceProcessClient({
      modelName,
      pythonProjectDir: mlxPythonDir,
      venvPath: mlxVenvPath,
      runtimeProfile: 'mlx',
      extraSpawnArgs: buildMlxSpawnArgs(options),
      loggerPrefix: 'MLX',
      mapSamplingOptions: (opts) => mapOptionsToPython(opts as MlxMlModelOptions | undefined, true),
      processExitErrorMessage: (code, signal) =>
        `MLX process exited unexpectedly (code=${code}, signal=${signal})`,
    });
  }

  async ensureInitialized(): Promise<void> {
    return this.client.ensureInitialized();
  }

  async getCapabilities(): Promise<MlxRuntimeInfo> {
    return this.client.getCapabilities();
  }

  async formatTest(messages: MlxMessage[], options?: { primer?: string }): Promise<MlxFormatTestResult> {
    return this.client.formatTest(messages, options);
  }

  async tokenize(
    messages: MlxMessage[],
    tools?: MlxToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<MlxTokenizeResult> {
    return this.client.tokenize(messages, tools, reasoningEffort);
  }

  async cachePrefill(
    cachePath: string,
    messages: MlxMessage[],
    baseCachePath?: string,
    trimToTokens?: number,
    prefixOffsets?: number[],
    prefixHashes?: string[],
    tools?: MlxToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<MlxCachePrefillResult> {
    return this.client.cachePrefill(
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

  async chat(
    messages: MlxMessage[],
    primer?: string,
    options?: MlxMlModelOptions,
    tools?: MlxToolDefinition[],
    images?: string[],
    maxImageSize?: number,
    reasoningEffort?: 'low' | 'medium' | 'high',
    cachePath?: string,
    cacheTrimTokens?: number,
  ): Promise<Readable> {
    return this.client.chat(
      messages,
      primer,
      options,
      tools,
      images,
      maxImageSize,
      reasoningEffort,
      cachePath,
      cacheTrimTokens,
    );
  }

  async completion(
    prompt: string,
    options?: MlxMlModelOptions,
    images?: string[],
    maxImageSize?: number,
  ): Promise<Readable> {
    return this.client.completion(prompt, options, images, maxImageSize);
  }

  async generate(
    prompt: string | number[],
    options?: MlxMlModelOptions,
    images?: string[],
    maxImageSize?: number,
  ): Promise<Readable> {
    return this.client.generate(prompt, options, images, maxImageSize);
  }

  async exit(): Promise<void> {
    return this.client.exit();
  }

  cancelActiveRequest(): void {
    this.client.cancelActiveRequest();
  }

  getStatus() {
    return this.client.getStatus();
  }
}
