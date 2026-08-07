import { describe, it, expect } from 'vitest';
import {
  parseDriverKind,
  resolveDriverSelection,
  buildMlxDriverOptions,
} from './driver-selection.js';
import type { DialogProfile } from './types.js';

describe('parseDriverKind', () => {
  it('accepts canonical names', () => {
    expect(parseDriverKind('mlx_lm')).toBe('mlx_lm');
    expect(parseDriverKind('mlx_optiq')).toBe('mlx_optiq');
    expect(parseDriverKind('pytorch')).toBe('pytorch');
  });

  it('normalizes hyphens and case', () => {
    expect(parseDriverKind('MLX-OPTiq')).toBe('mlx_optiq');
  });

  it('rejects unknown drivers', () => {
    expect(() => parseDriverKind('mlx_optq')).toThrow(/Unknown driver/);
  });
});

describe('resolveDriverSelection', () => {
  it('prefers CLI/profile driver over workflow model driver', () => {
    const profile: DialogProfile = {
      driver: 'pytorch',
      workflow: {
        models: {
          default: { provider: 'mlx', model: 'x', driver: 'mlx_optiq' },
        },
      },
    };
    expect(resolveDriverSelection(profile)).toEqual({ provider: 'pytorch' });
  });

  it('uses workflow model driver when profile driver is unset', () => {
    const profile: DialogProfile = {
      workflow: {
        models: {
          default: { provider: 'mlx', model: 'x', driver: 'mlx_optiq' },
        },
      },
    };
    expect(resolveDriverSelection(profile)).toEqual({
      provider: 'mlx',
      mlxBackend: 'optiq',
    });
  });

  it('maps textOnly to mlx_lm', () => {
    expect(resolveDriverSelection({ textOnly: true })).toEqual({
      provider: 'mlx',
      mlxBackend: 'lm',
    });
  });

  it('uses workflow pytorch provider when no driver hint', () => {
    expect(
      resolveDriverSelection({
        workflow: { models: { default: { provider: 'pytorch', model: 'gpt2' } } },
      }),
    ).toEqual({ provider: 'pytorch' });
  });
});

describe('buildMlxDriverOptions', () => {
  it('passes backend and cache options', () => {
    expect(
      buildMlxDriverOptions(
        { drafterModel: 'draft', cacheDir: '/tmp/cache' },
        'optiq',
      ),
    ).toEqual({
      backend: 'optiq',
      drafterModel: 'draft',
      cacheDir: '/tmp/cache',
    });
  });
});
