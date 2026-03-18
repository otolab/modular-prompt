/**
 * CLI argument parsing using commander
 */

import { Command } from 'commander';
import { resolve } from 'path';
import type { ExtendedExperimentOptions } from '../types.js';

export function parseArgs(): ExtendedExperimentOptions {
  const program = new Command();

  program
    .name('moduler-experiment')
    .description('Compare multiple prompt module variations')
    .argument('<config>', 'Config file path (YAML, TypeScript, or JavaScript)')
    .option('--test-case <name>', 'Test case name filter')
    .option('--model <provider>', 'Model provider filter (mlx, vertexai, googlegenai)')
    .option('--modules <names>', 'Comma-separated module names to test (default: all)')
    .option('--repeat <count>', 'Number of repetitions', '1')
    .option('--evaluate', 'Enable AI-based evaluation of outputs', false)
    .option('--evaluators <names>', 'Comma-separated evaluator names (default: all)')
    .option('--dry-run', 'Display execution plan without running the experiment', false)
    .option('--log-file <path>', 'Log file path for JSONL output (detailed logs)')
    .option('--verbose', 'Enable verbose output (show detailed internal operations)', false)
    .option('--trace-dir <dir>', 'Trace output directory (structured execution logs)')
    .parse();

  const config = program.args[0];
  const options = program.opts();

  return {
    configPath: resolve(process.cwd(), config),
    testCaseFilter: options.testCase,
    modelFilter: options.model,
    moduleFilter: options.modules?.split(',').map((s: string) => s.trim()),
    repeatCount: parseInt(options.repeat, 10),
    enableEvaluation: options.evaluate,
    evaluatorFilter: options.evaluators?.split(',').map((s: string) => s.trim()),
    dryRun: options.dryRun,
    logFile: options.logFile,
    verbose: options.verbose,
    traceDir: options.traceDir,
  };
}
