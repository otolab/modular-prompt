/**
 * MLX runtime status check and setup guidance
 */

import { existsSync } from 'node:fs';
import chalk from 'chalk';
import {
  getModularPromptHome,
  getRuntimeDir,
  getUserModelsConfigPath,
  getVenvPath,
  isRuntimeReady,
  resolveDefaultModelFromConfig,
  SETUP_MLX_CLI,
  SETUP_MLX_MONOREPO,
  type RuntimeProfile,
} from '@modular-prompt/driver';
import { resolveMergedModels } from './ai-chat.js';
import { BUNDLED_MODELS_CONFIG } from './default-models.js';

/** Published-package setup command (also works from monorepo) */
export const MLX_RUNTIME_CLI_SETUP = SETUP_MLX_CLI;

/** Monorepo workspace setup command */
export const MLX_MONOREPO_SETUP = SETUP_MLX_MONOREPO;

export const BUNDLED_DOCS_SETUP_GUIDE = './docs/LOCAL_MODEL_SETUP.md';

export function formatRuntimeNotReadyMessage(
  profile: RuntimeProfile,
  setupCommand: string,
): string {
  const venvPath = getVenvPath(profile);
  const lines = [
    chalk.red(`${profile} Python runtime is not set up.`),
    `Expected venv: ${venvPath}`,
    '',
    'Run one of the following:',
    `  ${setupCommand}`,
    `  ${MLX_RUNTIME_CLI_SETUP}`,
    `  ${MLX_MONOREPO_SETUP}  # monorepo only`,
    '',
    `See README (初回セットアップ) or ${BUNDLED_DOCS_SETUP_GUIDE} in this package.`,
  ];
  return lines.join('\n');
}

function printModelsConfigStatus(): void {
  const modelsPath = getUserModelsConfigPath();
  const userYamlExists = existsSync(modelsPath);
  const models = resolveMergedModels({});
  const aliases = Object.keys(models.models ?? {});
  const defaultModel = resolveDefaultModelFromConfig(models);
  const bundledDefault = BUNDLED_MODELS_CONFIG.models?.default?.model;

  console.log('');
  console.log('models config:');
  console.log(`  user yaml: ${modelsPath} (${userYamlExists ? 'found' : 'not found'})`);

  if (aliases.length > 0) {
    console.log(`  aliases: ${aliases.join(', ')}`);
  }

  if (defaultModel) {
    console.log(`  effective default: ${defaultModel.provider}:${defaultModel.model}`);
  }

  if (!userYamlExists) {
    console.log('  Tip: create user yaml with models.default or define aliases.');
  } else if (!defaultModel && !bundledDefault) {
    console.log('  Tip: define models.default or use CLI -m / profile.model.');
  }

  console.log('  CLI -m / profile.model override merged defaults.');
}

export function printRuntimeStatus(): boolean {
  const home = getModularPromptHome();
  const mlxReady = isRuntimeReady('mlx');
  const runtimePath = getRuntimeDir('mlx');
  const venvPath = getVenvPath('mlx');

  console.log(`modular-prompt home: ${home}\n`);

  const icon = mlxReady ? chalk.green('✓') : chalk.red('✗');
  const status = mlxReady ? 'ready' : 'not installed';
  console.log(`${icon} mlx: ${status}`);
  console.log(`  runtime: ${runtimePath}`);
  console.log(`  venv: ${venvPath}`);

  printModelsConfigStatus();

  if (!mlxReady) {
    console.log('');
    console.log('To set up MLX runtime:');
    console.log(`  ${MLX_RUNTIME_CLI_SETUP}`);
    console.log(`  ${MLX_MONOREPO_SETUP}  # monorepo only`);
    console.log('');
    console.log(
      'Runtime is machine-shared (~/.modular-prompt/runtimes/mlx/), not inside node_modules.',
    );
    console.log(`See ${BUNDLED_DOCS_SETUP_GUIDE} for details.`);
  }

  return mlxReady;
}
