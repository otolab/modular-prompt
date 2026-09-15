import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

/** ホーム配下の設定ディレクトリ名 */
export const MODULAR_PROMPT_DIR = '.modular-prompt';

/** サポートする runtime profile */
export const RUNTIME_PROFILES = ['mlx', 'pytorch'];

/** 初期 PyTorch runtime として提供する template variant */
export const PYTORCH_DEFAULT_VARIANT = 'cpu-minimal';

/**
 * ~/.modular-prompt のルートパス
 * MODULAR_PROMPT_HOME 環境変数で上書き可能（テスト用）
 */
export function getModularPromptHome() {
  if (process.env.MODULAR_PROMPT_HOME) {
    return process.env.MODULAR_PROMPT_HOME;
  }
  return path.join(os.homedir(), MODULAR_PROMPT_DIR);
}

export function getRuntimesRoot() {
  return path.join(getModularPromptHome(), 'runtimes');
}

export function getRuntimeDir(profile) {
  return path.join(getRuntimesRoot(), profile);
}

export function getVenvPath(profile) {
  return path.join(getRuntimeDir(profile), '.venv');
}

export function getManifestPath(profile) {
  return path.join(getRuntimeDir(profile), 'manifest.json');
}

/**
 * @modular-prompt/driver パッケージルートから MLX Python プロジェクトを解決
 */
function resolvePythonProjectDir(packageRoot, segment) {
  const distPython = path.join(packageRoot, 'dist', segment, 'python');
  const srcPython = path.join(packageRoot, 'src', segment, 'python');
  if (existsSync(distPython)) {
    return distPython;
  }
  if (existsSync(srcPython)) {
    return srcPython;
  }
  return srcPython;
}

function resolveTemplateDir(packageRoot, segment, variant) {
  const distTemplate = path.join(packageRoot, 'dist', segment, 'templates', variant);
  const srcTemplate = path.join(packageRoot, 'src', segment, 'templates', variant);
  if (existsSync(distTemplate)) {
    return distTemplate;
  }
  if (existsSync(srcTemplate)) {
    return srcTemplate;
  }
  return srcTemplate;
}

export function getMlxPythonDir(packageRoot) {
  return resolvePythonProjectDir(packageRoot, 'mlx-ml');
}

/** ~/.modular-prompt/runtimes/pytorch/python の実行時プロジェクト */
export function getPytorchRuntimePythonDir() {
  return path.join(getRuntimeDir('pytorch'), 'python');
}

/**
 * PyTorch の実行時プロジェクトを解決する後方互換 API。
 * packageRoot は旧実装との互換性のため受け取るが、現在は使用しない。
 */
export function getPytorchPythonDir(_packageRoot) {
  return getPytorchRuntimePythonDir();
}

/**
 * @modular-prompt/driver パッケージ内の PyTorch template を解決
 * @param {string} packageRoot
 * @param {string} [variant]
 */
export function getPytorchTemplateDir(packageRoot, variant = PYTORCH_DEFAULT_VARIANT) {
  return resolveTemplateDir(packageRoot, 'pytorch', variant);
}

export function isRuntimeReady(profile) {
  const venv = getVenvPath(profile);
  const venvReady =
    existsSync(path.join(venv, 'bin', 'python')) ||
    existsSync(path.join(venv, 'Scripts', 'python.exe'));
  if (!venvReady) {
    return false;
  }

  if (profile === 'pytorch') {
    const pythonDir = getPytorchRuntimePythonDir();
    return (
      existsSync(path.join(pythonDir, 'pyproject.toml')) &&
      existsSync(path.join(pythonDir, '__main__.py'))
    );
  }

  return true;
}
