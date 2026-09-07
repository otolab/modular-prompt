import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveDefaultContainerDir } from './constants.js';

describe('default extract cache container', () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-extract-cache-'));
    previousHome = process.env.MODULAR_PROMPT_HOME;
    process.env.MODULAR_PROMPT_HOME = tempHome;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.MODULAR_PROMPT_HOME;
    } else {
      process.env.MODULAR_PROMPT_HOME = previousHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('resolves the container below MODULAR_PROMPT_HOME without creating it', () => {
    const containerDir = resolveDefaultContainerDir();

    expect(containerDir).toBe(join(tempHome, 'extract-cache'));
    expect(existsSync(containerDir)).toBe(false);
  });
});
