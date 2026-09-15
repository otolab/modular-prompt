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

describe.skipIf(process.platform === 'win32')('PyTorch CUDA startup errors', () => {
  it('rejects CUDA-specific errors from capabilities and the first query', async () => {
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

      const capabilitiesDriver = new PyTorchDriver({ model: 'gpt2' });
      await expect(capabilitiesDriver.getCapabilities()).rejects.toThrow(
        CUDA_UNAVAILABLE_ERROR,
      );
      await capabilitiesDriver.close();

      const queryDriver = new PyTorchDriver({ model: 'gpt2' });
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [],
        output: [],
      };
      await expect(queryDriver.query(prompt)).rejects.toThrow(CUDA_UNAVAILABLE_ERROR);
      await queryDriver.close();
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
  }, 10_000);
});
