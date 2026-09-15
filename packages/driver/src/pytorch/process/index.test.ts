import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('PyTorchProcess setup errors', () => {
  let temporaryHome: string;
  const previousHome = process.env.MODULAR_PROMPT_HOME;

  beforeEach(() => {
    temporaryHome = mkdtempSync(join(tmpdir(), 'modular-prompt-pytorch-process-'));
    process.env.MODULAR_PROMPT_HOME = temporaryHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.MODULAR_PROMPT_HOME;
    } else {
      process.env.MODULAR_PROMPT_HOME = previousHome;
    }
    rmSync(temporaryHome, { recursive: true, force: true });
  });

  it('shows setup commands for monorepo and npm users when the project is missing', async () => {
    const { PyTorchProcess } = await import('./index.js');

    expect(() => new PyTorchProcess('gpt2')).toThrow(
      /pnpm run setup-pytorch \(monorepo\) or modular-prompt-runtime setup pytorch \(npm\)/,
    );
  });
});
