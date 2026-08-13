/**
 * Format subcommand: compile and format prompts without LLM execution
 */

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Logger } from '@modular-prompt/utils';
import { loadExperimentConfig } from './config/loader.js';
import { loadModules } from './config/dynamic-loader.js';
import { buildFormatPlan, renderFormattedOutput } from './prompt-formatter.js';
import type { FormatCommandOptions } from './cli/format-args.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('format');

export async function runFormatCommand(options: FormatCommandOptions): Promise<void> {
  Logger.configure({
    level: options.verbose ? 'debug' : 'info',
    accumulateLevel: 'debug',
    isMcpMode: false,
    accumulate: false,
    maxEntries: 1000,
  });

  console.log('='.repeat(80));
  console.log('Prompt Format');
  console.log('='.repeat(80));
  console.log(`Config: ${options.configPath}`);
  console.log(`Test case filter: ${options.testCaseFilter || 'all'}`);
  console.log(`Modules: ${options.moduleFilter?.join(', ') || 'all'}`);
  console.log(`Format: ${options.formatType}`);
  if (options.outputFile) {
    console.log(`Output: ${options.outputFile}`);
  }
  console.log('='.repeat(80));
  console.log();

  const {
    modules: configModules,
    testCases: configTestCases,
    configDir,
  } = await loadExperimentConfig(options.configPath);

  const testCases = options.testCaseFilter
    ? configTestCases.filter(tc => tc.name === options.testCaseFilter)
    : configTestCases;

  if (testCases.length === 0) {
    console.error(`❌ No test cases found${options.testCaseFilter ? ` matching: ${options.testCaseFilter}` : ''}`);
    process.exit(1);
  }

  const allModules = await loadModules(configModules, configDir);
  const modules = options.moduleFilter
    ? allModules.filter(m => options.moduleFilter!.includes(m.name))
    : allModules;

  if (modules.length === 0) {
    console.error('❌ No modules found');
    process.exit(1);
  }

  logger.verbose(`Formatting ${testCases.length} test case(s) × ${modules.length} module(s)`);

  const items = buildFormatPlan(modules, testCases);
  const output = renderFormattedOutput(items, options.formatType);

  if (options.outputFile) {
    await mkdir(dirname(options.outputFile), { recursive: true });
    await writeFile(options.outputFile, output);
    console.log(`📄 Formatted prompts written: ${options.outputFile}`);
  } else {
    process.stdout.write(output);
    if (!output.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }
}
