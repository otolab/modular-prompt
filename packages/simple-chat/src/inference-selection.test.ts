import { describe, it, expect, vi } from 'vitest';
import {
  parseMlxBackend,
  parseProvider,
  resolveInferenceSelection,
  buildMlxDriverOptions,
} from './inference-selection.js';
import type { DialogProfile } from './types.js';

describe('parseMlxBackend', () => {
  it('accepts canonical backend names', () => {
    expect(parseMlxBackend('lm')).toBe('lm');
    expect(parseMlxBackend('optiq')).toBe('optiq');
    expect(parseMlxBackend('auto')).toBe('auto');
  });

  it('accepts legacy mlx_* aliases', () => {
    expect(parseMlxBackend('mlx_optiq')).toBe('optiq');
    expect(parseMlxBackend('MLX-LM')).toBe('lm');
  });

  it('rejects unknown backends', () => {
    expect(() => parseMlxBackend('mlx_optq')).toThrow(/Unknown backend/);
  });
});

describe('resolveInferenceSelection', () => {
  it('prefers CLI/profile provider over workflow', () => {
    const profile: DialogProfile = {
      provider: 'pytorch',
      workflow: {
        models: {
          default: { provider: 'mlx', model: 'x', backend: 'optiq' },
        },
      },
    };
    expect(resolveInferenceSelection(profile)).toEqual({
      provider: 'pytorch',
      mlxBackend: 'optiq',
    });
  });

  it('uses workflow backend when profile backend is unset', () => {
    const profile: DialogProfile = {
      workflow: {
        models: {
          default: { provider: 'mlx', model: 'x', backend: 'optiq' },
        },
      },
    };
    expect(resolveInferenceSelection(profile)).toEqual({
      mlxBackend: 'optiq',
    });
  });

  it('maps textOnly to lm backend with deprecation warning', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => process);
    expect(resolveInferenceSelection({ textOnly: true })).toEqual({
      mlxBackend: 'lm',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns empty selection when nothing specified', () => {
    expect(resolveInferenceSelection({})).toEqual({});
  });
});

describe('parseProvider', () => {
  it('accepts pytorch', () => {
    expect(parseProvider('pytorch')).toBe('pytorch');
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

  it('omits backend when mlxBackend is auto', () => {
    expect(buildMlxDriverOptions({}, 'auto')).toBeUndefined();
  });
});
