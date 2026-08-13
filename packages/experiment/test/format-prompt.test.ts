/**
 * Prompt formatter and format command tests
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import {
  buildFormatPlan,
  renderFormattedOutput,
  formatCompiledPrompt,
  compileModulePrompt,
} from '../src/prompt-formatter.js';
import { loadExperimentConfig } from '../src/config/loader.js';
import { loadModules } from '../src/config/dynamic-loader.js';
import { parseFormatArgs } from '../src/cli/format-args.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const formatConfigPath = resolve(__dirname, 'fixtures/format-test-config.yaml');

describe('prompt-formatter', () => {
  it('should build format plan for all testCase × module combinations', async () => {
    const { modules: configModules, testCases, configDir } =
      await loadExperimentConfig(formatConfigPath);
    const modules = await loadModules(configModules, configDir);

    const items = buildFormatPlan(modules, testCases);

    // Test Case 1: 2 modules, Test Case 2: 1 module (filtered by testCase.modules)
    expect(items).toHaveLength(3);
    expect(items.map(i => `${i.moduleName}/${i.testCaseName}`)).toEqual([
      'test-module/Test Case 1',
      'test-module-b/Test Case 1',
      'test-module/Test Case 2',
    ]);
  });

  it('should filter by test case name', async () => {
    const { modules: configModules, testCases, configDir } =
      await loadExperimentConfig(formatConfigPath);
    const modules = await loadModules(configModules, configDir);

    const filtered = testCases.filter(tc => tc.name === 'Test Case 1');
    const items = buildFormatPlan(modules, filtered);

    expect(items).toHaveLength(2);
    expect(items.every(i => i.testCaseName === 'Test Case 1')).toBe(true);
  });

  it('should filter by module names', async () => {
    const { modules: configModules, testCases, configDir } =
      await loadExperimentConfig(formatConfigPath);
    const allModules = await loadModules(configModules, configDir);
    const modules = allModules.filter(m => m.name === 'test-module-b');

    const items = buildFormatPlan(modules, testCases);

    expect(items).toHaveLength(1);
    expect(items[0].moduleName).toBe('test-module-b');
    expect(items[0].testCaseName).toBe('Test Case 1');
  });

  it('should render completion format with section headers', async () => {
    const { modules: configModules, testCases, configDir } =
      await loadExperimentConfig(formatConfigPath);
    const modules = await loadModules(configModules, configDir);
    const items = buildFormatPlan(modules, [testCases[0]]);

    const output = renderFormattedOutput(items, 'completion');

    expect(output).toContain('=== test-module / Test Case 1 ===');
    expect(output).toContain('=== test-module-b / Test Case 1 ===');
    expect(output).toContain('# Instructions');
  });

  it('should render compiled format as JSON', async () => {
    const { modules: configModules, testCases, configDir } =
      await loadExperimentConfig(formatConfigPath);
    const modules = await loadModules(configModules, configDir);
    const items = buildFormatPlan(modules, [testCases[0]]);

    const output = renderFormattedOutput(items, 'compiled');
    const parsed = JSON.parse(output);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      testCase: 'Test Case 1',
      module: 'test-module',
    });
    expect(parsed[0].compiled.instructions).toBeDefined();
  });

  it('should format compiled prompt without LLM dependencies', async () => {
    const { modules: configModules, testCases, configDir } =
      await loadExperimentConfig(formatConfigPath);
    const modules = await loadModules(configModules, configDir);
    const compiled = compileModulePrompt(modules[0].module, testCases[0].input);

    expect(formatCompiledPrompt(compiled, 'completion')).toContain('# Instructions');
    expect(JSON.parse(formatCompiledPrompt(compiled, 'compiled'))).toHaveProperty('instructions');
    expect(JSON.parse(formatCompiledPrompt(compiled, 'messages'))).toBeInstanceOf(Array);
  });
});

describe('parseFormatArgs', () => {
  it('should parse format subcommand arguments', () => {
    const options = parseFormatArgs([
      'node',
      'modular-experiment',
      'config.yaml',
      '--test-case',
      'Test Case 1',
      '--modules',
      'mod-a,mod-b',
      '--format',
      'compiled',
      '--output',
      'out.json',
      '--verbose',
    ]);

    expect(options.configPath).toBe(resolve(process.cwd(), 'config.yaml'));
    expect(options.testCaseFilter).toBe('Test Case 1');
    expect(options.moduleFilter).toEqual(['mod-a', 'mod-b']);
    expect(options.formatType).toBe('compiled');
    expect(options.outputFile).toBe('out.json');
    expect(options.verbose).toBe(true);
  });

  it('should default format type to completion', () => {
    const options = parseFormatArgs([
      'node',
      'modular-experiment',
      'config.yaml',
    ]);

    expect(options.formatType).toBe('completion');
  });
});
