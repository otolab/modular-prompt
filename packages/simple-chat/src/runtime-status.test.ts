import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeNotReadyError, getUserModelsConfigPath } from '@modular-prompt/driver';
import {
  BUNDLED_DOCS_SETUP_GUIDE,
  formatRuntimeNotReadyMessage,
  MLX_MONOREPO_SETUP,
  MLX_RUNTIME_CLI_SETUP,
  printRuntimeStatus,
} from './runtime-status.js';

describe('runtime-status', () => {
  let tempHome: string;
  let previousHome: string | undefined;
  let stdoutLines: string[];

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-runtime-status-'));
    previousHome = process.env.MODULAR_PROMPT_HOME;
    process.env.MODULAR_PROMPT_HOME = tempHome;
    stdoutLines = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdoutLines.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) {
      delete process.env.MODULAR_PROMPT_HOME;
    } else {
      process.env.MODULAR_PROMPT_HOME = previousHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('formatRuntimeNotReadyMessage includes setup commands and bundled docs path', () => {
    const error = new RuntimeNotReadyError('mlx');
    const message = formatRuntimeNotReadyMessage(error.profile, error.setupCommand);

    expect(message).toContain('mlx Python runtime is not set up');
    expect(message).toContain(error.setupCommand);
    expect(message).toContain(MLX_RUNTIME_CLI_SETUP);
    expect(message).toContain(MLX_MONOREPO_SETUP);
    expect(message).toContain(BUNDLED_DOCS_SETUP_GUIDE);
    expect(message).not.toContain('in the repository');
  });

  it('printRuntimeStatus shows models.yaml path and aliases', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  local-chat:
    provider: mlx
    model: user/model
`,
    );

    printRuntimeStatus();

    const output = stdoutLines.join('\n');
    expect(output).toContain(getUserModelsConfigPath());
    expect(output).toContain('aliases: default, local-chat');
    expect(output).toContain('effective default:');
    expect(output).toContain(BUNDLED_DOCS_SETUP_GUIDE);
  });

  it('printRuntimeStatus notes missing user yaml and bundled default', () => {
    expect(existsSync(getUserModelsConfigPath())).toBe(false);

    printRuntimeStatus();

    const output = stdoutLines.join('\n');
    expect(output).toContain('not found');
    expect(output).toContain('bundled default:');
    expect(output).toContain('CLI -m / profile.model override merged defaults.');
  });
});
