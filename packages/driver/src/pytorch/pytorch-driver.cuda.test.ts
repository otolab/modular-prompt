import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { CompiledPrompt } from '@modular-prompt/core';

const CUDA_UNAVAILABLE_ERROR =
  'CUDA device requested, but CUDA is not available in this PyTorch runtime. ' +
  'Install a CUDA-enabled torch wheel and verify the NVIDIA driver.';

type PyTorchDriverConstructor = typeof import('./pytorch-driver.js').PyTorchDriver;

async function withFakeCudaRuntime<T>(
  callback: (PyTorchDriver: PyTorchDriverConstructor) => Promise<T>,
): Promise<T> {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'modular-prompt-pytorch-cuda-'));
  const fakeBinDirectory = join(temporaryDirectory, 'bin');
  const fakeUvPath = join(fakeBinDirectory, 'uv');
  const runtimeDirectory = join(temporaryDirectory, 'runtimes', 'pytorch');
  const pythonDirectory = join(runtimeDirectory, 'python');
  const venvPythonDirectory = join(runtimeDirectory, '.venv', 'bin');
  const previousHome = process.env.MODULAR_PROMPT_HOME;
  const previousPath = process.env.PATH;

  try {
    mkdirSync(fakeBinDirectory, { recursive: true });
    writeFileSync(
      fakeUvPath,
      `#!/usr/bin/env node
process.stderr.write(${JSON.stringify(`RuntimeError: ${CUDA_UNAVAILABLE_ERROR}`)} + '\\n');
setTimeout(() => process.exit(1), 10);
`,
    );
    chmodSync(fakeUvPath, 0o755);

    mkdirSync(pythonDirectory, { recursive: true });
    mkdirSync(venvPythonDirectory, { recursive: true });
    writeFileSync(join(pythonDirectory, 'pyproject.toml'), '[project]\nname = "test"\n');
    writeFileSync(join(pythonDirectory, '__main__.py'), '');
    writeFileSync(join(venvPythonDirectory, 'python'), '');

    process.env.MODULAR_PROMPT_HOME = temporaryDirectory;
    process.env.PATH = `${fakeBinDirectory}:${previousPath ?? ''}`;
    vi.resetModules();
    const { PyTorchDriver } = await import('./pytorch-driver.js');
    return await callback(PyTorchDriver);
  } finally {
    if (previousHome === undefined) {
      delete process.env.MODULAR_PROMPT_HOME;
    } else {
      process.env.MODULAR_PROMPT_HOME = previousHome;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    vi.resetModules();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function expectCudaErrorWithin(promise: Promise<unknown>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Timed out waiting for the CUDA startup error')),
      2_000,
    );
  });

  try {
    await expect(Promise.race([promise, timeoutPromise])).rejects.toThrow(
      CUDA_UNAVAILABLE_ERROR,
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

const EMPTY_PROMPT: CompiledPrompt = {
  instructions: [],
  data: [],
  output: [],
};

describe.skipIf(process.platform === 'win32')('PyTorch CUDA startup errors', () => {
  it('rejects CUDA-specific errors from capabilities and the first query', async () => {
    await withFakeCudaRuntime(async (PyTorchDriver) => {
      const capabilitiesDriver = new PyTorchDriver({ model: 'gpt2' });
      await expect(capabilitiesDriver.getCapabilities()).rejects.toThrow(
        CUDA_UNAVAILABLE_ERROR,
      );
      await capabilitiesDriver.close();

      const queryDriver = new PyTorchDriver({ model: 'gpt2' });
      await expect(queryDriver.query(EMPTY_PROMPT)).rejects.toThrow(CUDA_UNAVAILABLE_ERROR);
      await queryDriver.close();
    });
  }, 10_000);

  it('rejects requests added after the process exits before any API request', async () => {
    await withFakeCudaRuntime(async (PyTorchDriver) => {
      const driver = new PyTorchDriver({ model: 'gpt2' });

      // The fake uv exits before the first request is submitted, leaving the queue empty.
      await new Promise((resolve) => setTimeout(resolve, 200));

      await expectCudaErrorWithin(driver.getCapabilities());
      await expectCudaErrorWithin(driver.query(EMPTY_PROMPT));
      await driver.close();
    });
  }, 10_000);
});
