import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTO_REBUILD_CACHE_ENV,
  resolveAutoRebuildCache,
  resolveDefaultContainerDir,
} from './constants.js';

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

describe('automatic extract cache rebuild setting', () => {
  let previousValue: string | undefined;

  beforeEach(() => {
    previousValue = process.env[AUTO_REBUILD_CACHE_ENV];
    delete process.env[AUTO_REBUILD_CACHE_ENV];
  });

  afterEach(() => {
    if (previousValue === undefined) {
      delete process.env[AUTO_REBUILD_CACHE_ENV];
    } else {
      process.env[AUTO_REBUILD_CACHE_ENV] = previousValue;
    }
  });

  it('defaults to enabled and gives config precedence over the environment', () => {
    expect(resolveAutoRebuildCache()).toBe(true);
    process.env[AUTO_REBUILD_CACHE_ENV] = 'false';
    expect(resolveAutoRebuildCache()).toBe(false);
    expect(resolveAutoRebuildCache(true)).toBe(true);
  });

  it('accepts common boolean environment spellings and rejects invalid values', () => {
    for (const value of ['false', '0', 'no', 'off']) {
      process.env[AUTO_REBUILD_CACHE_ENV] = value;
      expect(resolveAutoRebuildCache()).toBe(false);
    }
    for (const value of ['true', '1', 'yes', 'on']) {
      process.env[AUTO_REBUILD_CACHE_ENV] = value;
      expect(resolveAutoRebuildCache()).toBe(true);
    }
    process.env[AUTO_REBUILD_CACHE_ENV] = 'maybe';
    expect(() => resolveAutoRebuildCache()).toThrow(AUTO_REBUILD_CACHE_ENV);
  });
});
