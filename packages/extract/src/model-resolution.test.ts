import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getUserModelsConfigPath,
} from '@modular-prompt/driver';
import { BUNDLED_DEFAULT_MODEL, BUNDLED_MODELS_CONFIG } from './default-models.js';
import { resolveMergedModels, resolveModelSpec } from './model-resolution.js';

describe('extract model resolution', () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-extract-models-'));
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

  it('resolves an alias from the merged user models.yaml', () => {
    writeFileSync(
      getUserModelsConfigPath(),
      `models:
  default:
    provider: mlx
    model: user/default-model
`,
    );

    expect(resolveModelSpec('default', resolveMergedModels())).toMatchObject({
      provider: 'mlx',
      model: 'user/default-model',
    });
    expect(resolveModelSpec(undefined, resolveMergedModels()).model)
      .toBe('user/default-model');
  });

  it('accepts a raw HF model ID and infers the MLX provider', () => {
    expect(resolveModelSpec('mlx-community/example-4bit', {})).toEqual({
      model: 'mlx-community/example-4bit',
      provider: 'mlx',
      capabilities: [],
    });
  });

  it('uses models.default, then the first entry when no model is specified', () => {
    expect(resolveModelSpec(undefined, {
      models: {
        first: { provider: 'mlx', model: 'first/model' },
        second: { provider: 'mlx', model: 'second/model' },
      },
    }).model).toBe('first/model');

    expect(resolveModelSpec(undefined, BUNDLED_MODELS_CONFIG).model)
      .toBe(BUNDLED_DEFAULT_MODEL);
  });

  it('explains how to configure a model when none is available', () => {
    expect(() => resolveModelSpec(undefined, {})).toThrow(
      /specify -m <model-id-or-alias>.*models\.default.*~\/\.modular-prompt\/models\.yaml/,
    );
  });
});
