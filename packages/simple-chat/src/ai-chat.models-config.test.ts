/**
 * resolveModelSpec / resolveProfileModelSpec tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getUserModelsConfigPath } from '@modular-prompt/driver';
import {
  resolveModelSpec,
  resolveProfileModelSpec,
  resolveMergedModels,
} from './ai-chat.js';
import { BUNDLED_MODELS_CONFIG } from './default-models.js';
import type { DialogProfile } from './types.js';

const INLINE_MODELS = {
  models: {
    'local-chat': { provider: 'mlx' as const, model: 'inline/model' },
    default: { provider: 'mlx' as const, model: 'inline/default' },
  },
};

describe('resolveModelSpec', () => {
  it('prefers override.model over profile.model and workflow', () => {
    const profile: DialogProfile = {
      model: 'profile-model',
      workflow: {
        models: {
          default: { ref: 'local-chat' },
        },
      },
    };

    const spec = resolveModelSpec(profile, INLINE_MODELS, { model: 'override-model' });
    expect(spec.model).toBe('override-model');
  });

  it('prefers profile.model over workflow.models.default', () => {
    const profile: DialogProfile = {
      model: 'local-chat',
      workflow: {
        models: {
          default: { provider: 'mlx', model: 'workflow/model' },
        },
      },
    };

    const spec = resolveModelSpec(profile, INLINE_MODELS);
    expect(spec.model).toBe('inline/model');
  });

  it('resolves workflow ref from injected models without filesystem', () => {
    const profile: DialogProfile = {
      workflow: {
        models: {
          default: { ref: 'local-chat' },
        },
      },
    };

    const spec = resolveModelSpec(profile, INLINE_MODELS);
    expect(spec.model).toBe('inline/model');
  });

  it('falls back to models.default alias', () => {
    const spec = resolveModelSpec({}, INLINE_MODELS);
    expect(spec.model).toBe('inline/default');
  });
});

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

  it('uses bundled default model when no workflow model specified', () => {
    const spec = resolveProfileModelSpec({});
    expect(spec.model).toBe(BUNDLED_MODELS_CONFIG.models!.default!.model);
    expect(spec.provider).toBe('mlx');
  });

  it('user default alias overrides bundled default', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  default:
    provider: mlx
    model: user/default-model
`
    );

    const spec = resolveProfileModelSpec({});
    expect(spec.model).toBe('user/default-model');
  });

  it('CLI override wins over workflow default', () => {
    const profile: DialogProfile = {
      workflow: {
        models: {
          default: { provider: 'mlx', model: 'workflow/model' },
        },
      },
    };

    const spec = resolveProfileModelSpec(profile, { model: 'cli-model' });
    expect(spec.model).toBe('cli-model');
  });

  it('profile.model resolves alias when defined in merged models', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  local-chat:
    provider: mlx
    model: user/model
`
    );

    const spec = resolveProfileModelSpec({ model: 'local-chat' });
    expect(spec.model).toBe('user/model');
  });

  it('override.model resolves alias from merged models', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  local-chat:
    provider: mlx
    model: user/model
`
    );

    const spec = resolveProfileModelSpec({}, { model: 'local-chat' });
    expect(spec.model).toBe('user/model');
  });

  it('throws on unknown model ref', () => {
    expect(() => resolveProfileModelSpec({
      workflow: {
        models: {
          default: { ref: 'missing-alias' },
        },
      },
    })).toThrow(/Unknown model ref 'missing-alias'/);
  });
});

describe('resolveMergedModels', () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-chat-merge-'));
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

  it('merges bundled, user, and profile overlay', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  shared:
    provider: mlx
    model: user/shared
`
    );

    const merged = resolveMergedModels({
      modelsConfig: {
        models: {
          shared: { provider: 'mlx', model: 'profile/shared' },
        },
      },
    });

    expect(merged.models?.shared?.model).toBe('profile/shared');
    expect(merged.models?.default?.model).toBe(BUNDLED_MODELS_CONFIG.models!.default!.model);
  });
});
