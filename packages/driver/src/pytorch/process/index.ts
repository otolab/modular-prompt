/**
 * PyTorch Driver 外部インターフェース
 */

import { Readable } from 'stream';
import { existsSync } from 'fs';
import {
  getPytorchPythonDir,
  getVenvPath,
  resolvePackageRootFromProcessModule,
  SETUP_PYTORCH_MONOREPO,
} from '../../runtime/index.js';
import { InferenceProcessClient } from '../../local-inference/process-client.js';
import type {
  InferenceCapabilities,
  InferenceFormatTestResult,
  InferenceMessage,
  InferenceRenderResult,
  InferenceTokenizeResult,
  InferenceToolDefinition,
} from '../../local-inference/protocol.js';
import { mapOptionsToPython } from '../../mlx-ml/process/parameter-mapper.js';
import type { PyTorchQueryOptions } from '../pytorch-options.js';

const packageRoot = resolvePackageRootFromProcessModule(import.meta.url);
const pytorchPythonDir = getPytorchPythonDir(packageRoot);

export interface PyTorchProcessOptions {
  /** デフォルトの ~/.modular-prompt/runtimes/pytorch/.venv を上書き */
  venvPath?: string;
  /** Python 子プロセスへ渡す PYTORCH_DEVICE（例: cpu, cuda） */
  device?: string;
}

function resolveVenvPath(options?: PyTorchProcessOptions): string {
  return (
    options?.venvPath ??
    process.env.MODULAR_PROMPT_PYTORCH_VENV ??
    getVenvPath('pytorch')
  );
}

function usesDefaultRuntimeVenv(venvPath: string): boolean {
  return venvPath === getVenvPath('pytorch');
}

export class PyTorchProcess {
  readonly modelName: string;
  private readonly client: InferenceProcessClient;

  constructor(modelName: string, options?: PyTorchProcessOptions) {
    this.modelName = modelName;

    const venvPath = resolveVenvPath(options);
    if (!existsSync(venvPath)) {
      throw new Error(
        `PyTorch venv not found at ${venvPath}. ` +
          `Run: ${SETUP_PYTORCH_MONOREPO}`,
      );
    }

    const device = options?.device ?? process.env.PYTORCH_DEVICE;
    const extraEnv = device ? { PYTORCH_DEVICE: device } : undefined;

    this.client = new InferenceProcessClient({
      modelName,
      pythonProjectDir: pytorchPythonDir,
      venvPath,
      runtimeProfile: usesDefaultRuntimeVenv(venvPath) ? 'pytorch' : undefined,
      extraEnv,
      loggerPrefix: 'PyTorch',
      mapSamplingOptions: (opts) => mapOptionsToPython(opts as PyTorchQueryOptions | undefined, false),
      processExitErrorMessage: (code, signal) =>
        `PyTorch process exited unexpectedly (code=${code}, signal=${signal})`,
    });
  }

  async ensureInitialized(): Promise<void> {
    return this.client.ensureInitialized();
  }

  async getCapabilities(): Promise<InferenceCapabilities> {
    return this.client.getCapabilities();
  }

  async formatTest(
    messages: InferenceMessage[],
    options?: { primer?: string },
  ): Promise<InferenceFormatTestResult> {
    return this.client.formatTest(messages, options);
  }

  async render(
    messages: InferenceMessage[],
    options?: Record<string, unknown> & { primer?: string },
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceRenderResult> {
    return this.client.render(messages, options, tools, reasoningEffort);
  }

  async tokenize(
    messages: InferenceMessage[],
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<InferenceTokenizeResult> {
    return this.client.tokenize(messages, tools, reasoningEffort);
  }

  async generate(
    prompt: string | number[],
    options?: Record<string, unknown>,
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
