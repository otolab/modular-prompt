/**
 * resolveProfileModelSpec integration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getUserModelsConfigPath } from '@modular-prompt/driver';
import { resolveProfileModelSpec } from './ai-chat.js';
import type { DialogProfile } from './types.js';

describe('resolveProfileModelSpec with models.yaml', () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-chat-'));
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
      workflow: {
        models: {
          default: { ref: 'local-chat' },
        },
      },
    };

    const spec = resolveProfileModelSpec(profile);
    expect(spec.model).toBe('user/model');
    expect(spec.provider).toBe('mlx');
  });

  it('profile overlay overrides user models in merge mode', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  local-chat:
    provider: mlx
    model: user/model
`
    );

    const profile: DialogProfile = {
      modelsConfig: {
        mode: 'merge',
        models: {
          'local-chat': {
            provider: 'mlx',
            model: 'overlay/model',
          },
        },
      },
      workflow: {
        models: {
          default: { ref: 'local-chat' },
        },
      },
    };

    const spec = resolveProfileModelSpec(profile);
    expect(spec.model).toBe('overlay/model');
  });

  it('uses defaults.mlx-lm when no workflow model specified', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `defaults:
  mlx-lm: config/default-model
`
    );

    const profile: DialogProfile = {};

    const spec = resolveProfileModelSpec(profile);
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
    };

    const spec = resolveProfileModelSpec(profile);
    expect(spec.model).toBe('cli-model');
  });

  it('throws on unknown model ref', () => {
    const profile: DialogProfile = {
      workflow: {
        models: {
          default: { ref: 'missing-alias' },
        },
      },
    };

    expect(() => resolveProfileModelSpec(profile)).toThrow(
      /Unknown model ref 'missing-alias'/,
    );
  });
});
