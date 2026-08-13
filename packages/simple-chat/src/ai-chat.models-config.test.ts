/**
 * resolveProfileModelSpec integration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getUserModelsConfigPath, getProjectModelsConfigPath } from '@modular-prompt/driver';
import { resolveProfileModelSpec } from './ai-chat.js';
import type { DialogProfile } from './types.js';

describe('resolveProfileModelSpec with models.yaml', () => {
  let tempHome: string;
  let projectRoot: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-chat-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'project-chat-'));
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
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('resolves workflow ref from user models config', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  local-chat:
    provider: mlx
    model: user/model
`
    );

    const profile: DialogProfile = {
      modelsConfig: { projectRoot },
      workflow: {
        models: {
          default: { ref: 'local-chat' },
        },
      },
    };

    const spec = resolveProfileModelSpec(profile, { projectRoot });
    expect(spec.model).toBe('user/model');
    expect(spec.provider).toBe('mlx');
  });

  it('project models override user models in merge mode', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  local-chat:
    provider: mlx
    model: user/model
`
    );
    mkdirSync(join(projectRoot, '.modular-prompt'), { recursive: true });
    writeFileSync(
      getProjectModelsConfigPath(projectRoot),
      `models:
  local-chat:
    provider: mlx
    model: project/model
`
    );

    const profile: DialogProfile = {
      modelsConfig: { projectRoot, mode: 'merge' },
      workflow: {
        models: {
          default: { ref: 'local-chat' },
        },
      },
    };

    const spec = resolveProfileModelSpec(profile, { projectRoot });
    expect(spec.model).toBe('project/model');
  });

  it('uses defaults.mlx-lm when no workflow model specified', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `defaults:
  mlx-lm: config/default-model
`
    );

    const profile: DialogProfile = {
      modelsConfig: { projectRoot },
    };

    const spec = resolveProfileModelSpec(profile, { projectRoot });
    expect(spec.model).toBe('config/default-model');
    expect(spec.provider).toBe('mlx');
  });

  it('profile.model CLI override wins over models config', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `defaults:
  mlx-lm: config/default-model
`
    );

    const profile: DialogProfile = {
      model: 'cli-model',
      modelsConfig: { projectRoot },
    };

    const spec = resolveProfileModelSpec(profile, { projectRoot });
    expect(spec.model).toBe('cli-model');
  });
});
