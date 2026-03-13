/**
 * experiment.yaml のテストケースごとにコンパイル済みプロンプトを出力する
 *
 * Usage:
 *   node packages/process/experiments/agentic-workflow/inspect-prompts.mjs [test-case-filter]
 */
import { pathToFileURL } from 'url';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../../..');

const { compile } = await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')));
const { formatCompletionPrompt } = await import(pathToFileURL(resolve(root, 'packages/driver/dist/index.js')));
const { loadExperimentConfig, loadModules } = await import(pathToFileURL(resolve(root, 'packages/experiment/dist/index.js')));

const configPath = resolve(__dirname, 'experiment.yaml');
const filter = process.argv[2];

const config = await loadExperimentConfig(configPath);
const modules = await loadModules(config.modules, config.configDir);

for (const testCase of config.testCases) {
  if (filter && !testCase.name.includes(filter)) continue;

  const targetModules = testCase.modules
    ? modules.filter(m => testCase.modules.includes(m.name))
    : modules;

  for (const mod of targetModules) {
    console.log('='.repeat(80));
    console.log(`Test: ${testCase.name}`);
    console.log(`Module: ${mod.name}`);
    if (testCase.process) console.log(`Process: ${testCase.process}`);
    console.log('='.repeat(80));

    const compiled = compile(mod.module, testCase.input);
    console.log(formatCompletionPrompt(compiled));
    console.log();
  }
}
