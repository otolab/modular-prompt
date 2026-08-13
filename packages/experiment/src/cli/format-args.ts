/**
 * CLI argument parsing for format subcommand
 */

import { Command } from 'commander';
import { resolve } from 'path';
import type { PromptFormatType } from '../prompt-formatter.js';

export interface FormatCommandOptions {
  configPath: string;
  testCaseFilter?: string;
  moduleFilter?: string[];
  formatType: PromptFormatType;
  outputFile?: string;
  verbose?: boolean;
}

const VALID_FORMAT_TYPES: PromptFormatType[] = ['completion', 'messages', 'compiled'];

export function parseFormatArgs(argv: string[] = process.argv): FormatCommandOptions {
  const program = new Command();

  program
    .name('modular-experiment format')
    .description('Format compiled prompts without LLM execution')
    .argument('<config>', 'Config file path (YAML, TypeScript, or JavaScript)')
    .option('--test-case <name>', 'Test case name filter')
    .option('--modules <names>', 'Comma-separated module names (default: all)')
    .option('--format <type>', 'Output format: completion, messages, compiled', 'completion')
    .option('--output <path>', 'Output file path (default: stdout)')
    .option('--verbose', 'Enable verbose output', false)
    .parse(argv);

  const config = program.args[0];
  const options = program.opts();
  const formatType = options.format as PromptFormatType;

  if (!VALID_FORMAT_TYPES.includes(formatType)) {
    console.error(`❌ Invalid format type: ${options.format}`);
    console.error(`   Valid values: ${VALID_FORMAT_TYPES.join(', ')}`);
    process.exit(1);
  }

  return {
    configPath: resolve(process.cwd(), config),
    testCaseFilter: options.testCase,
    moduleFilter: options.modules?.split(',').map((s: string) => s.trim()),
    formatType,
    outputFile: options.output,
    verbose: options.verbose,
  };
}
