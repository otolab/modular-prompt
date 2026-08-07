import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

/** ホーム配下の設定ディレクトリ名 */
export const MODULAR_PROMPT_DIR = '.modular-prompt';

/** サポートする runtime profile */
export const RUNTIME_PROFILES = ['mlx'];

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
export function getMlxPythonDir(packageRoot) {
  const distPython = path.join(packageRoot, 'dist', 'mlx-ml', 'python');
  const srcPython = path.join(packageRoot, 'src', 'mlx-ml', 'python');
  if (existsSync(distPython)) {
    return distPython;
  }
  if (existsSync(srcPython)) {
    return srcPython;
  }
  return srcPython;
}

export function isRuntimeReady(profile) {
  const venv = getVenvPath(profile);
  return (
    existsSync(path.join(venv, 'bin', 'python')) ||
    existsSync(path.join(venv, 'Scripts', 'python.exe'))
  );
}
