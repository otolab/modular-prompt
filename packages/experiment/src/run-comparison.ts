#!/usr/bin/env node
/**
 * Module Comparison Experiment
 *
 * Compares the performance and output quality of multiple prompt modules.
 *
 * Usage:
 *   moduler-experiment <config> [options]
 *
 * Arguments:
 *   <config>             Config file path (YAML, TypeScript, or JavaScript)
 *
 * Options:
 *   --test-case <name>   Test case name filter
 *   --model <provider>   Model provider filter (mlx, vertexai, googlegenai)
 *   --modules <names>    Comma-separated module names (default: all)
 *   --repeat <count>     Number of repetitions (default: 1)
 *   --evaluate           Enable evaluation phase
 *   --evaluators <names> Comma-separated evaluator names (default: all)
 *   --dry-run            Display execution plan without running the experiment
 */

import { parseArgs } from './cli/args.js';
import { loadExperimentConfig } from './config/loader.js';
import { loadModules, loadEvaluators } from './config/dynamic-loader.js';
import { DriverManager } from './runner/driver-manager.js';
import { ExperimentRunner } from './runner/experiment.js';
import { StatisticsReporter } from './reporter/statistics.js';
import { Logger } from '@modular-prompt/utils';

// Helper function to check if an entry is a DriverSetConfig
function isDriverSetConfig(entry: any): boolean {
  return entry && typeof entry === 'object' && 'set' in entry && typeof entry.set === 'object';
}

// Parse CLI arguments
const options = parseArgs();

// Configure logger
Logger.configure({
  level: options.verbose ? 'debug' : 'info',
  accumulateLevel: 'debug',
  isMcpMode: false,
  accumulate: !!options.logFile,
  maxEntries: 10000,
  logFile: options.logFile,
});

// Display header
console.log('='.repeat(80));
console.log('Module Comparison Experiment');
console.log('='.repeat(80));
console.log(`Config: ${options.configPath}`);
console.log(`Test case filter: ${options.testCaseFilter || 'all'}`);
console.log(`Model filter: ${options.modelFilter || 'all enabled models'}`);
console.log(`Modules: ${options.moduleFilter?.join(', ') || 'all'}`);
console.log(`Repeat: ${options.repeatCount} time(s)`);
console.log(`Evaluation: ${options.enableEvaluation ? 'enabled' : 'disabled'}`);
if (options.enableEvaluation) {
  console.log(`Evaluators: ${options.evaluatorFilter?.join(', ') || 'all'}`);
}
console.log(`Dry run: ${options.dryRun ? 'enabled (plan only)' : 'disabled'}`);
console.log('='.repeat(80));
console.log();

// Load configuration
const {
  serverConfig,
  modules: configModules,
  testCases: configTestCases,
  evaluators: configEvaluators,
  aiService,
  configDir
} = await loadExperimentConfig(options.configPath);

// Keep models as object for experiment runner
const models = serverConfig.models;

// Display available models for logging
const modelEntries = Object.entries(models).filter(([_, entry]: [string, any]) => {
  if (isDriverSetConfig(entry)) return !entry.disabled;
  return !entry.disabled && (!entry.role || entry.role === 'test');
});

if (options.modelFilter) {
  const filteredEntries = modelEntries.filter(([_, entry]: [string, any]) => {
    if (isDriverSetConfig(entry)) {
      return Object.values(entry.set).some((spec: any) => spec.provider === options.modelFilter);
    }
    return entry.provider === options.modelFilter;
  });
  if (filteredEntries.length === 0) {
    console.error(`❌ No enabled test models found for provider: ${options.modelFilter}`);
    process.exit(1);
  }
  console.log(`📋 Testing with ${filteredEntries.length} model(s) (filtered by ${options.modelFilter}):`);
  filteredEntries.forEach(([name, entry]: [string, any]) => {
    if (isDriverSetConfig(entry)) {
      const roles = Object.entries(entry.set)
        .map(([role, spec]: [string, any]) => `${role}=${spec.model}`)
        .join(', ');
      console.log(`  - ${name}: [set] ${roles}`);
    } else {
      console.log(`  - ${name}: ${entry.model} (${entry.provider})`);
    }
  });
} else {
  console.log(`📋 Testing with ${modelEntries.length} model(s):`);
  modelEntries.forEach(([name, entry]: [string, any]) => {
    if (isDriverSetConfig(entry)) {
      const roles = Object.entries(entry.set)
        .map(([role, spec]: [string, any]) => `${role}=${spec.model}`)
        .join(', ');
      console.log(`  - ${name}: [set] ${roles}`);
    } else {
      console.log(`  - ${name}: ${entry.model} (${entry.provider})`);
    }
  });
}

// Warn about MLX resource usage
const hasMLX = modelEntries.some(([_, entry]: [string, any]) => {
  if (isDriverSetConfig(entry)) {
    return Object.values(entry.set).some((spec: any) => spec.provider === 'mlx');
  }
  return entry.provider === 'mlx';
});
if (hasMLX) {
  console.log();
  console.log('⚠️  MLX models detected: Running multiple MLX models may consume significant system resources (CPU/Memory)');
}
console.log();

// Load test cases
const allTestCases = configTestCases;
const testCases = options.testCaseFilter
  ? allTestCases.filter((tc: any) => tc.name === options.testCaseFilter)
  : allTestCases;

if (testCases.length === 0) {
  console.error(`❌ No test cases found${options.testCaseFilter ? ` matching: ${options.testCaseFilter}` : ''}`);
  console.error('   Please add test cases to config file');
  process.exit(1);
}

console.log(`🧪 Running ${testCases.length} test case(s)`);
console.log();

// Load modules (from module references)
const allModules = await loadModules(configModules, configDir);
const modules = options.moduleFilter
  ? allModules.filter(m => options.moduleFilter!.includes(m.name))
  : allModules;

if (modules.length === 0) {
  console.error('❌ No modules to test');
  console.error('   Please add modules to config file');
  process.exit(1);
}

console.log(`📦 Testing ${modules.length} module(s):`);
modules.forEach(m => console.log(`  - ${m.name}: ${m.description}`));
console.log();

// Get evaluators and evaluator model if evaluation is enabled
let evaluators;
let evaluatorModel;
if (options.enableEvaluation) {
  // Load evaluators (from evaluator references)
  const allEvaluators = await loadEvaluators(configEvaluators, configDir);
  evaluators = options.evaluatorFilter
    ? allEvaluators.filter(e => options.evaluatorFilter!.includes(e.name))
    : allEvaluators;

  if (evaluators.length === 0) {
    console.error('❌ No evaluators found');
    process.exit(1);
  }

  // Find evaluator model from evaluation config
  if (!serverConfig.evaluation || !serverConfig.evaluation.enabled) {
    console.error('❌ Evaluation is not configured in config file');
    console.error('   Please add evaluation section to your config.yaml:');
    console.error('   evaluation:');
    console.error('     enabled: true');
    console.error('     model: "model-name"');
    console.error('     provider: "provider-name"');
    process.exit(1);
  }

  const evaluationConfig = serverConfig.evaluation;

  // Find the specified model by name
  const modelName = evaluationConfig.model;
  const modelSpec = serverConfig.models[modelName];

  if (!modelSpec || modelSpec.disabled) {
    console.error(`❌ Evaluator model not found or disabled: ${modelName}`);
    console.error('   Please ensure the model is defined in the models section and enabled');
    process.exit(1);
  }

  evaluatorModel = { name: modelName, spec: modelSpec };

  console.log(`🔍 Evaluation enabled with ${evaluators.length} evaluator(s):`);
  evaluators.forEach(e => console.log(`  - [${e.type}] ${e.name}: ${e.description}`));
  console.log(`🔍 Evaluator model: ${modelName} (${modelSpec.provider}:${modelSpec.model})`);
  console.log();
}

// Exit if dry run
if (options.dryRun) {
  console.log('='.repeat(80));
  console.log('✅ Configuration validated successfully');
  console.log('📋 Execution plan displayed above');
  console.log('   Remove --dry-run to execute the experiment');
  console.log('='.repeat(80));
  process.exit(0);
}

// Run experiment
const driverManager = new DriverManager();
const runner = new ExperimentRunner(
  aiService,
  driverManager,
  modules,
  testCases,
  models,
  options.repeatCount,
  evaluators,
  evaluatorModel
);

const results = await runner.run();

// Display completion
console.log('='.repeat(80));
console.log('✨ Experiment completed');
console.log('='.repeat(80));

// Flush log file if configured
if (options.logFile) {
  const { logger } = await import('./logger.js');
  await logger.flush();
  console.log(`📄 Log file written: ${options.logFile}`);
}

// Cleanup drivers
await driverManager.cleanup();

// Display statistics if repeated
if (options.repeatCount > 1) {
  const reporter = new StatisticsReporter(results);
  reporter.report();
}
