import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
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
  });
});
