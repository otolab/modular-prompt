/**
 * models.yaml loader / resolve tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadModelsConfigFile,
  normalizeModelsSection,
  mergeModelsConfig,
  resolveModelsConfig,
  resolveModelReference,
  resolveDefaultModel,
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
defaults:
  mlx-lm: user-default-model
models:
  local-chat:
    provider: mlx
    model: user/model
    capabilities: [local, chat]
`;
      writeFileSync(getUserModelsConfigPath(), yaml);

      const config = loadModelsConfigFile(getUserModelsConfigPath());
      expect(config?.defaults?.['mlx-lm']).toBe('user-default-model');
      expect(config?.models?.['local-chat']?.model).toBe('user/model');
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
          defaults: { 'mlx-lm': 'user-default' },
        },
        {
          models: {
            b: { provider: 'mlx', model: 'project/b' },
            c: { provider: 'openai', model: 'project/c' },
          },
          defaults: { 'mlx-lm': 'project-default' },
        },
        'merge'
      );

      expect(merged.models?.a?.model).toBe('user/a');
      expect(merged.models?.b?.model).toBe('project/b');
      expect(merged.models?.c?.model).toBe('project/c');
      expect(merged.defaults?.['mlx-lm']).toBe('project-default');
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
    it('merges user config with overlay (overlay priority)', () => {
      writeFileSync(
        getUserModelsConfigPath(),
        `models:
  shared:
    provider: mlx
    model: user/shared
`
      );

      const resolved = resolveModelsConfig({
        mode: 'merge',
        overlay: {
          models: {
            shared: { provider: 'mlx', model: 'overlay/shared' },
            overlay-only: { provider: 'mlx', model: 'overlay/only' },
          },
        },
      });

      expect(resolved.models?.shared?.model).toBe('overlay/shared');
      expect(resolved.models?.['overlay-only']?.model).toBe('overlay/only');
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
      defaults: { 'mlx-lm': 'default/model' },
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

    it('resolves runtime via defaults', () => {
      const spec = resolveModelReference({ runtime: 'mlx-lm' }, config);
      expect(spec?.model).toBe('default/model');
      expect(spec?.metadata?.runtime).toBe('mlx-lm');
    });
  });

  describe('resolveDefaultModel', () => {
    it('returns model from defaults', () => {
      const spec = resolveDefaultModel('mlx-lm', {
        defaults: { 'mlx-lm': 'my/default' },
      });
      expect(spec?.model).toBe('my/default');
      expect(spec?.provider).toBe('mlx');
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
