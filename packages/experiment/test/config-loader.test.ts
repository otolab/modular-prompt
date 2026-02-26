/**
 * Configuration loader tests
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compile } from '@modular-prompt/core';
import { loadExperimentConfig } from '../src/config/loader.js';
import { loadModules } from '../src/config/dynamic-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Config Loader', () => {
  it('should load YAML config and resolve configDir', async () => {
    const configPath = resolve(__dirname, 'fixtures/test-config.yaml');
    const {
      serverConfig,
      modules,
      testCases,
      evaluators,
      aiService,
      configDir
    } = await loadExperimentConfig(configPath);

    // configDirが設定ファイルのディレクトリになっていることを確認
    expect(configDir).toBe(resolve(__dirname, 'fixtures'));

    // serverConfigが正しくロードされていることを確認
    expect(Object.keys(serverConfig.models)).toHaveLength(1);
    expect(serverConfig.models['test-model']).toBeDefined();
    expect(serverConfig.models['test-model'].model).toBe('test-model');
    expect(serverConfig.models['test-model'].provider).toBe('test');

    // modules, testCases, evaluatorsが正しくロードされていることを確認
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('test-module');
    expect(testCases).toHaveLength(1);
    expect(testCases[0].name).toBe('Test Case 1');
    expect(evaluators).toHaveLength(0);

    // AIServiceが初期化されていることを確認
    expect(aiService).toBeDefined();
  });

  it('should load modules from config-relative path', async () => {
    const configPath = resolve(__dirname, 'fixtures/test-config.yaml');
    const { modules: configModules, configDir } = await loadExperimentConfig(configPath);

    // モジュールをロード（configDirからの相対パス）
    const modules = await loadModules(configModules, configDir);

    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('test-module');
    expect(modules[0].description).toBe('Test module');
    expect(modules[0].module).toBeDefined();

    // モジュールがコンパイルできることを確認
    const compiled = compile(modules[0].module, { input: 'hello world' });
    expect(compiled).toBeDefined();
    expect(compiled.instructions).toBeDefined();
  });

  it('should load test cases from config', async () => {
    const configPath = resolve(__dirname, 'fixtures/test-config.yaml');
    const { testCases } = await loadExperimentConfig(configPath);

    expect(testCases).toHaveLength(1);
    expect(testCases[0].name).toBe('Test Case 1');
    expect(testCases[0].input).toEqual({
      query: 'test input',
      context: 'some context',
    });
  });

  it('should load TypeScript config with jiti', async () => {
    const configPath = resolve(__dirname, 'fixtures/test-config.ts');
    const {
      serverConfig,
      modules,
      testCases,
      evaluators,
      aiService,
      configDir
    } = await loadExperimentConfig(configPath);

    // configDirが設定ファイルのディレクトリになっていることを確認
    expect(configDir).toBe(resolve(__dirname, 'fixtures'));

    // serverConfigが正しくロードされていることを確認
    expect(Object.keys(serverConfig.models)).toHaveLength(1);
    expect(serverConfig.models['test-model-ts']).toBeDefined();
    expect(serverConfig.models['test-model-ts'].model).toBe('test-model-ts');
    expect(serverConfig.models['test-model-ts'].provider).toBe('test');

    // modules, testCases, evaluatorsが正しくロードされていることを確認
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('test-module-ts');
    expect(testCases).toHaveLength(1);
    expect(testCases[0].name).toBe('Test Case from TS');
    expect(evaluators).toHaveLength(0);

    // AIServiceが初期化されていることを確認
    expect(aiService).toBeDefined();
  });
});
