#!/usr/bin/env node

/**
 * Python runtime 管理 CLI
 *
 * setup mlx    — ~/.modular-prompt/runtimes/mlx に venv を作成
 * setup --status
 * cleanup mlx [--yes]
 * cleanup --all [--yes]
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const driverVersion = readPackageVersion();

function runtimeModuleUrl(name) {
  const distPath = join(packageRoot, 'dist', 'runtime', name);
  const srcPath = join(packageRoot, 'src', 'runtime', name);
  return pathToFileURL(existsSync(distPath) ? distPath : srcPath).href;
}

const {
  RUNTIME_PROFILES,
  getModularPromptHome,
  getRuntimeDir,
  getVenvPath,
  getMlxPythonDir,
  isRuntimeReady,
} = await import(runtimeModuleUrl('paths-core.mjs'));

const {
  collectInstalledPackages,
  readManifest,
  writeManifest,
} = await import(runtimeModuleUrl('manifest-core.mjs'));

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function ensureUv() {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return;
  } catch {
    console.log('⚠️  uv is not installed. Installing uv...');
    execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: 'inherit' });
  }
}

function setupMlx() {
  if (process.platform !== 'darwin') {
    console.error('❌ MLX runtime is only available on macOS (Apple Silicon).');
    console.error('   For local inference on this platform, use vLLM or a future PyTorch runtime.');
    process.exit(1);
  }

  const pythonDir = getMlxPythonDir(packageRoot);
  if (!existsSync(pythonDir)) {
    console.error(`❌ MLX Python project not found: ${pythonDir}`);
    process.exit(1);
  }

  const venvPath = getVenvPath('mlx');
  const runtimeDir = getRuntimeDir('mlx');

  console.log('🚀 Setting up MLX runtime...\n');
  console.log(`📁 Python project: ${pythonDir}`);
  console.log(`📁 Runtime venv:  ${venvPath}\n`);

  ensureUv();
  mkdirSync(runtimeDir, { recursive: true });

  const env = {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: venvPath,
  };

  try {
    execSync('uv venv --python 3.13', { cwd: pythonDir, stdio: 'inherit', env });
    execSync('uv pip install -e .', { cwd: pythonDir, stdio: 'inherit', env });

    writeManifest('mlx', {
      profile: 'mlx',
      driverVersion,
      platform: process.platform,
      pythonVersion: '3.13',
      createdAt: new Date().toISOString(),
      packages: collectInstalledPackages(pythonDir, venvPath),
    });

    console.log('\n✅ MLX runtime setup completed.');
    console.log(`   Home: ${getModularPromptHome()}`);
    console.log('   You can now use MlxDriver from @modular-prompt/driver');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to setup MLX runtime:', message);
    process.exit(1);
  }
}

function printStatus() {
  console.log(`modular-prompt home: ${getModularPromptHome()}\n`);
  for (const profile of RUNTIME_PROFILES) {
    const ready = isRuntimeReady(profile);
    const manifest = ready ? readManifest(profile) : null;
    const detail = manifest
      ? ` (driver ${manifest.driverVersion}, ${manifest.createdAt})`
      : '';
    const icon = ready ? '✅' : '❌';
    const runtimePath = getRuntimeDir(profile);
    console.log(`${icon} ${profile}: ${ready ? 'ready' : 'not installed'}${detail}`);
    console.log(`   ${runtimePath}`);
  }
  if (!isRuntimeReady('mlx')) {
    console.log('\nRun: pnpm run setup-mlx -w @modular-prompt/driver');
  }
}

async function confirm(message) {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) {
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return String(answer).toLowerCase() === 'y' || String(answer).toLowerCase() === 'yes';
}

async function cleanupProfile(profile) {
  if (!existsSync(getRuntimeDir(profile))) {
    console.log(`ℹ️  ${profile}: nothing to clean (${getRuntimeDir(profile)} does not exist)`);
    return;
  }
  const ok = await confirm(`Delete ${profile} runtime at ${getRuntimeDir(profile)}?`);
  if (!ok) {
    console.log('Cancelled.');
    return;
  }
  rmSync(getRuntimeDir(profile), { recursive: true, force: true });
  console.log(`✅ Removed ${profile} runtime.`);
}

async function cleanupAll() {
  const home = getModularPromptHome();
  if (!existsSync(home)) {
    console.log(`ℹ️  Nothing to clean (${home} does not exist)`);
    return;
  }
  const ok = await confirm(`Delete entire modular-prompt home at ${home}?`);
  if (!ok) {
    console.log('Cancelled.');
    return;
  }
  rmSync(home, { recursive: true, force: true });
  console.log(`✅ Removed ${home}`);
}

function printUsage() {
  console.log(`Usage:
  node scripts/runtime-cli.js setup mlx       Set up MLX Python runtime (macOS only)
  node scripts/runtime-cli.js setup --status  Show runtime status
  node scripts/runtime-cli.js cleanup mlx     Remove MLX runtime
  node scripts/runtime-cli.js cleanup --all   Remove entire ~/.modular-prompt
  node scripts/runtime-cli.js cleanup ... --yes  Skip confirmation

  npm scripts: setup-mlx, runtime:status, runtime:cleanup`);
}

async function main() {
  const [command, target] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  if (command === 'setup') {
    if (target === '--status' || target === 'status') {
      printStatus();
      return;
    }
    if (target === 'mlx') {
      setupMlx();
      return;
    }
    console.error(`Unknown setup target: ${target ?? '(none)'}`);
    printUsage();
    process.exit(1);
  }

  if (command === 'cleanup') {
    if (target === '--all' || target === 'all') {
      await cleanupAll();
      return;
    }
    if (target === 'mlx') {
      await cleanupProfile('mlx');
      return;
    }
    console.error(`Unknown cleanup target: ${target ?? '(none)'}`);
    printUsage();
    process.exit(1);
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
