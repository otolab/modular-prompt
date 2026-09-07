import { describe, expect, it } from 'vitest';
import { deriveTestDriversConfig } from './test-config.js';

describe('integration test config', () => {
  it('derives MLX test models from testing aliases', () => {
    const config = deriveTestDriversConfig({
      models: {
        default: {
          provider: 'mlx',
          model: 'test/default',
          driverOptions: { backend: 'lm' },
        },
        'mlx-native-tool': {
          provider: 'mlx',
          model: 'test/native',
        },
        'mlx-fallback-tool': {
          provider: 'mlx',
          model: 'test/fallback',
        },
      },
    });

    expect(config.mlx).toEqual({
      defaultModel: 'test/default',
      nativeModel: 'test/native',
      fallbackModel: 'test/fallback',
      backend: 'lm',
    });
  });

  it('derives provider credentials and model aliases', () => {
    const config = deriveTestDriversConfig({
      models: {
        anthropic: {
          provider: 'anthropic',
          model: 'claude-test',
        },
      },
      drivers: {
        anthropic: {
          apiKey: 'test-key',
        },
      },
    });

    expect(config.anthropic).toEqual({
      apiKey: 'test-key',
      model: 'claude-test',
    });
  });

  it('uses the first active MLX model as the default when no default alias exists', () => {
    const config = deriveTestDriversConfig({
      models: {
        disabled: {
          provider: 'mlx',
          model: 'test/disabled',
          disabled: true,
        },
        local: {
          provider: 'mlx',
          model: 'test/local',
        },
      },
    });

    expect(config.mlx).toEqual({
      defaultModel: 'test/local',
      nativeModel: undefined,
      fallbackModel: undefined,
    });
  });
});
