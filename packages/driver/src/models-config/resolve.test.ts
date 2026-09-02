/**
 * models.yaml loader / resolve tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadModelsConfigFile,
  normalizeModelsSection,
  mergeModelsConfig,
  resolveModelsConfig,
  resolveModelReference,
  resolveModelName,
  resolveDefaultModelFromConfig,
  registerModelsFromConfig,
  entryToModelSpec,
} from './index.js';
import { getUserModelsConfigPath } from './paths.js';
import { DriverRegistry } from '../driver-registry/registry.js';

describe('models-config', () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-models-'));
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
    vi.restoreAllMocks();
  });

  describe('normalizeModelsSection', () => {
    it('normalizes array format with id', () => {
      const result = normalizeModelsSection([
        {
          id: 'local-chat',
          provider: 'mlx',
          model: 'test/model',
          capabilities: ['chat'],
        },
      ]);

      expect(result).toEqual({
        'local-chat': {
          provider: 'mlx',
          model: 'test/model',
          capabilities: ['chat'],
        },
      });
    });
  });

  describe('loadModelsConfigFile', () => {
    it('returns null when file does not exist', () => {
      expect(loadModelsConfigFile('/nonexistent/models.yaml')).toBeNull();
    });

    it('throws on invalid YAML', () => {
      const badPath = join(tempHome, 'bad-models.yaml');
      writeFileSync(badPath, ':\n  [invalid');
      expect(() => loadModelsConfigFile(badPath)).toThrow();
    });

    it('loads user models.yaml from MODULAR_PROMPT_HOME', () => {
      const yaml = `
models:
  local-chat:
    provider: mlx
    model: user/model
    capabilities: [local, chat]
`;
      writeFileSync(getUserModelsConfigPath(), yaml);

      const config = loadModelsConfigFile(getUserModelsConfigPath());
      expect(config?.models?.['local-chat']?.model).toBe('user/model');
    });

    it('warns and ignores deprecated defaults section', () => {
      const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => process);

      const config = loadModelsConfigFile(
        (() => {
          const path = join(tempHome, 'deprecated-defaults.yaml');
          writeFileSync(
            path,
            `defaults:
  mlx-lm: ignored-model
models:
  default:
    provider: mlx
    model: kept/model
`
          );
          return path;
        })()
      );

      expect(warn).toHaveBeenCalled();
      expect(config?.models?.default?.model).toBe('kept/model');
      expect((config as { defaults?: unknown }).defaults).toBeUndefined();
    });
  });

  describe('mergeModelsConfig', () => {
    it('shallow merges models in merge mode', () => {
      const merged = mergeModelsConfig(
        {
          models: {
            a: { provider: 'mlx', model: 'user/a' },
            b: { provider: 'mlx', model: 'user/b' },
          },
        },
        {
          models: {
            b: { provider: 'mlx', model: 'project/b' },
            c: { provider: 'openai', model: 'project/c' },
          },
        },
        'merge'
      );

      expect(merged.models?.a?.model).toBe('user/a');
      expect(merged.models?.b?.model).toBe('project/b');
      expect(merged.models?.c?.model).toBe('project/c');
    });

    it('overrides user models in override mode when overlay has models', () => {
      const merged = mergeModelsConfig(
        {
          models: {
            a: { provider: 'mlx', model: 'user/a' },
            b: { provider: 'mlx', model: 'user/b' },
          },
        },
        {
          models: {
            b: { provider: 'mlx', model: 'project/b' },
          },
        },
        'override'
      );

      expect(merged.models).toEqual({
        b: { provider: 'mlx', model: 'project/b' },
      });
    });
  });

  describe('resolveModelsConfig', () => {
    it('merges base, user config, and overlay (overlay priority)', () => {
      writeFileSync(
        getUserModelsConfigPath(),
        `models:
  shared:
    provider: mlx
    model: user/shared
`
      );

      const resolved = resolveModelsConfig({
        base: {
          models: {
            default: { provider: 'mlx', model: 'bundled/default' },
          },
        },
        overlay: {
          models: {
            shared: { provider: 'mlx', model: 'overlay/shared' },
            'overlay-only': { provider: 'mlx', model: 'overlay/only' },
          },
        },
      });

      expect(resolved.models?.default?.model).toBe('bundled/default');
      expect(resolved.models?.shared?.model).toBe('overlay/shared');
      expect(resolved.models?.['overlay-only']?.model).toBe('overlay/only');
    });

    it('ignores user config when source is overlay', () => {
      writeFileSync(
        getUserModelsConfigPath(),
        `models:
  local:
    provider: mlx
    model: user/local
`
      );

      const resolved = resolveModelsConfig({
        source: 'overlay',
        overlay: {
          models: {
            local: { provider: 'mlx', model: 'overlay/local' },
          },
        },
      });

      expect(resolved.models?.local?.model).toBe('overlay/local');
    });

    it('returns user config only when overlay is omitted', () => {
      writeFileSync(
        getUserModelsConfigPath(),
        `models:
  local:
    provider: mlx
    model: user/local
`
      );

      const resolved = resolveModelsConfig();
      expect(resolved.models?.local?.model).toBe('user/local');
    });
  });

  describe('resolveModelReference', () => {
    const config = {
      models: {
        local: { provider: 'mlx', model: 'alias/model', capabilities: ['chat'] },
      },
    };

    it('resolves ref alias', () => {
      const spec = resolveModelReference({ ref: 'local' }, config);
      expect(spec?.model).toBe('alias/model');
      expect(spec?.provider).toBe('mlx');
    });

    it('resolves provider+model directly', () => {
      const spec = resolveModelReference({
        provider: 'openai',
        model: 'gpt-4o',
      }, config);
      expect(spec?.model).toBe('gpt-4o');
      expect(spec?.provider).toBe('openai');
    });
  });

  describe('resolveModelName', () => {
    const config = {
      models: {
        local: { provider: 'mlx', model: 'alias/model' },
      },
    };

    it('resolves known alias', () => {
      const spec = resolveModelName('local', config, () => 'mlx');
      expect(spec.model).toBe('alias/model');
    });

    it('falls back to raw model name', () => {
      const spec = resolveModelName('raw/model', config, () => 'mlx');
      expect(spec.model).toBe('raw/model');
      expect(spec.provider).toBe('mlx');
    });
  });

  describe('resolveDefaultModelFromConfig', () => {
    it('prefers default alias', () => {
      const spec = resolveDefaultModelFromConfig({
        models: {
          default: { provider: 'mlx', model: 'my/default' },
          other: { provider: 'mlx', model: 'other/model' },
        },
      });
      expect(spec?.model).toBe('my/default');
    });

    it('falls back to first model entry', () => {
      const spec = resolveDefaultModelFromConfig({
        models: {
          first: { provider: 'mlx', model: 'first/model' },
          second: { provider: 'mlx', model: 'second/model' },
        },
      });
      expect(spec?.model).toBe('first/model');
    });
  });

  describe('entryToModelSpec', () => {
    it('stores runtime in metadata', () => {
      const spec = entryToModelSpec({
        provider: 'mlx',
        model: 'test',
        runtime: 'mlx-lm',
      });
      expect(spec.metadata?.runtime).toBe('mlx-lm');
    });
  });

  describe('registerModelsFromConfig', () => {
    it('registers models into DriverRegistry', () => {
      const registry = new DriverRegistry();
      registerModelsFromConfig(registry, {
        models: {
          echo: { provider: 'echo', model: 'echo-test', capabilities: [] },
        },
      });

      const result = registry.selectModel({});
      expect(result?.model.provider).toBe('echo');
    });
  });
});
