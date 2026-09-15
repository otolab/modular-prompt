import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import {
  getPytorchPythonDir,
  getPytorchRuntimePythonDir,
  getPytorchTemplateDir,
  getModularPromptHome,
  getRuntimeDir,
  getVenvPath,
  getManifestPath,
} from './paths.js';
import { isRuntimeReady, RuntimeNotReadyError, assertRuntimeReady } from './check.js';

describe('runtime paths', () => {
  let tempHome: string;
  const previous = process.env.MODULAR_PROMPT_HOME;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-test-'));
    process.env.MODULAR_PROMPT_HOME = tempHome;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.MODULAR_PROMPT_HOME;
    } else {
      process.env.MODULAR_PROMPT_HOME = previous;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('resolves home and mlx runtime paths under MODULAR_PROMPT_HOME', () => {
    expect(getModularPromptHome()).toBe(tempHome);
    expect(getRuntimeDir('mlx')).toBe(join(tempHome, 'runtimes', 'mlx'));
    expect(getVenvPath('mlx')).toBe(join(tempHome, 'runtimes', 'mlx', '.venv'));
    expect(getManifestPath('mlx')).toBe(join(tempHome, 'runtimes', 'mlx', 'manifest.json'));
  });

  it('assertRuntimeReady throws RuntimeNotReadyError when venv is missing', () => {
    expect(isRuntimeReady('mlx')).toBe(false);
    expect(() => assertRuntimeReady('mlx')).toThrow(RuntimeNotReadyError);
    expect(() => assertRuntimeReady('pytorch')).toThrow(/setup pytorch/);
  });

  it('resolves the PyTorch project to the runtime and templates to a variant', () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

    expect(getPytorchRuntimePythonDir()).toBe(
      join(tempHome, 'runtimes', 'pytorch', 'python'),
    );
    expect(getPytorchPythonDir(packageRoot)).toBe(getPytorchRuntimePythonDir());
    expect(getPytorchTemplateDir(packageRoot)).toBe(
      join(packageRoot, 'src', 'pytorch', 'templates', 'cpu-minimal'),
    );
    expect(getPytorchTemplateDir(packageRoot, 'cuda')).toBe(
      join(packageRoot, 'src', 'pytorch', 'templates', 'cuda'),
    );
  });

  it('requires both the PyTorch venv and runtime project', () => {
    const venvPath = getVenvPath('pytorch');
    const pythonDir = getPytorchRuntimePythonDir();
    mkdirSync(join(venvPath, 'bin'), { recursive: true });
    writeFileSync(join(venvPath, 'bin', 'python'), '');

    expect(isRuntimeReady('pytorch')).toBe(false);
    mkdirSync(pythonDir, { recursive: true });
    writeFileSync(join(pythonDir, 'pyproject.toml'), '[project]\nname = "test"\n');
    expect(isRuntimeReady('pytorch')).toBe(false);
    writeFileSync(join(pythonDir, '__main__.py'), '');
    expect(isRuntimeReady('pytorch')).toBe(true);
  });
});
