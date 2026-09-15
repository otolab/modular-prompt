/**
 * PyTorch Driver 外部インターフェース
 */

import { Readable } from 'stream';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  getPytorchRuntimePythonDir,
  getVenvPath,
  SETUP_PYTORCH_CLI,
  SETUP_PYTORCH_MONOREPO,
} from '../../runtime/index.js';
import { InferenceProcessClient } from '../../local-inference/process-client.js';
import type {
  InferenceCapabilities,
  InferenceCachePrefillResult,
  InferenceFormatTestResult,
  InferenceMessage,
  InferenceRenderResult,
  InferenceTokenizeResult,
  InferenceToolDefinition,
} from '../../local-inference/protocol.js';
import { mapOptionsToPython } from '../../mlx-ml/process/parameter-mapper.js';
import type { PyTorchQueryOptions } from '../pytorch-options.js';

const pytorchPythonDir = getPytorchRuntimePythonDir();

export interface PyTorchProcessOptions {
  /** デフォルトの ~/.modular-prompt/runtimes/pytorch/.venv を上書き */
  venvPath?: string;
  /** Python 子プロセスへ渡す PYTORCH_DEVICE（例: cpu, cuda） */
  device?: string;
}

export const PYTORCH_CUDA_UNAVAILABLE_ERROR =
  'CUDA device requested, but CUDA is not available in this PyTorch runtime. ' +
  'Install a CUDA-enabled torch wheel and verify the NVIDIA driver.';

const PYTORCH_CUDA_ERROR_MARKER =
  'CUDA device requested, but CUDA is not available';

function formatPytorchProcessExitError(
  code: number | null,
  signal: string | null,
  stderr?: string,
): string {
  if (stderr?.includes(PYTORCH_CUDA_ERROR_MARKER)) {
    return PYTORCH_CUDA_UNAVAILABLE_ERROR;
  }
  return `PyTorch process exited unexpectedly (code=${code}, signal=${signal})`;
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

    if (
      !existsSync(join(pytorchPythonDir, 'pyproject.toml')) ||
      !existsSync(join(pytorchPythonDir, '__main__.py'))
    ) {
      throw new Error(
        `PyTorch runtime Python project not found at ${pytorchPythonDir}. ` +
          `Run: ${SETUP_PYTORCH_MONOREPO} (monorepo) or ${SETUP_PYTORCH_CLI} (npm).`,
      );
    }

    const venvPath = resolveVenvPath(options);
    if (!existsSync(venvPath)) {
      throw new Error(
        `PyTorch venv not found at ${venvPath}. ` +
          `Run: ${SETUP_PYTORCH_MONOREPO} (monorepo) or ${SETUP_PYTORCH_CLI} (npm).`,
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
      processExitErrorMessage: (code, signal, stderr) =>
        formatPytorchProcessExitError(code, signal, stderr),
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

  async cachePrefill(
    cachePath: string,
    messages: InferenceMessage[],
    baseCachePath?: string,
    trimToTokens?: number,
    prefixOffsets?: number[],
    prefixHashes?: string[],
    tools?: InferenceToolDefinition[],
    reasoningEffort?: 'low' | 'medium' | 'high',
    images?: string[],
    maxImageSize?: number,
  ): Promise<InferenceCachePrefillResult> {
    return this.client.cachePrefill(
      cachePath,
      messages,
      baseCachePath,
      trimToTokens,
      prefixOffsets,
      prefixHashes,
      tools,
      reasoningEffort,
      images,
      maxImageSize,
    );
  }

  async generate(
    prompt: string | number[],
    options?: Record<string, unknown>,
    images?: string[],
    maxImageSize?: number,
    cachePath?: string,
    cacheTrimTokens?: number,
    primer?: string,
  ): Promise<Readable> {
    return this.client.generate(
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
    return this.client.exit();
  }

  cancelActiveRequest(): void {
    this.client.cancelActiveRequest();
  }

  getStatus() {
    return this.client.getStatus();
  }
}
