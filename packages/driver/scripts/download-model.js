#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');

function runtimeModuleUrl(name) {
  const distPath = join(packageRoot, 'dist', 'runtime', name);
  const srcPath = join(packageRoot, 'src', 'runtime', name);
  return pathToFileURL(existsSync(distPath) ? distPath : srcPath).href;
}

const { getMlxPythonDir, getVenvPath } = await import(runtimeModuleUrl('paths-core.mjs'));
const { SETUP_MLX_MONOREPO } = await import(runtimeModuleUrl('setup-commands-core.mjs'));

const targetDir = getMlxPythonDir(packageRoot);
const venvPath = getVenvPath('mlx');

if (!existsSync(targetDir)) {
  console.error('❌ MLX Python directory not found.');
  console.error(`   Please run "${SETUP_MLX_MONOREPO}" first.`);
  process.exit(1);
}

if (!existsSync(join(venvPath, 'bin', 'python'))) {
  console.error('❌ MLX runtime is not set up.');
  console.error(`   Please run "${SETUP_MLX_MONOREPO}" first.`);
  process.exit(1);
}

console.log('📦 Downloading test model...');
console.log(`📁 Working directory: ${targetDir}\n`);

const modelName = process.argv[2] || 'mlx-community/gemma-3-270m-it-4bit';

try {
  execSync(
    `uv run mlx_lm.generate --model ${modelName} --prompt 'test' --max-tokens 1`,
    {
      cwd: targetDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: venvPath,
      },
    }
  );
  console.log('\n✅ Model downloaded successfully!');
  console.log(`   Model: ${modelName}`);
} catch (error) {
  console.error('\n❌ Failed to download model:', error.message);
  process.exit(1);
}
