/**
 * MLX runtime status check and setup guidance
 */

import chalk from 'chalk';
import {
  getModularPromptHome,
  getRuntimeDir,
  getVenvPath,
  isRuntimeReady,
  SETUP_MLX_MONOREPO,
  SETUP_MLX_CLI,
  type RuntimeProfile,
} from '@modular-prompt/driver';

/** Published-package setup command (also works from monorepo) */
export const MLX_RUNTIME_CLI_SETUP = SETUP_MLX_CLI;

/** Monorepo workspace setup command */
export const MLX_MONOREPO_SETUP = SETUP_MLX_MONOREPO;

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
    '',
    'See README (初回セットアップ) or docs/LOCAL_MODEL_SETUP.md in the repository.',
  ];
  return lines.join('\n');
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

  if (!mlxReady) {
    console.log('');
    console.log('To set up MLX runtime:');
    console.log(`  ${MLX_MONOREPO_SETUP}`);
    console.log(`  ${MLX_RUNTIME_CLI_SETUP}`);
    console.log('');
    console.log(
      'Runtime is machine-shared (~/.modular-prompt/runtimes/mlx/), not inside node_modules.',
    );
  }

  return mlxReady;
}
