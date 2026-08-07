import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/** ホーム配下の設定ディレクトリ名 */
export const MODULAR_PROMPT_DIR = '.modular-prompt';

/** サポートする runtime profile */
export type RuntimeProfile = 'mlx';

export const RUNTIME_PROFILES: RuntimeProfile[] = ['mlx'];

/**
 * ~/.modular-prompt のルートパス
 * MODULAR_PROMPT_HOME 環境変数で上書き可能（テスト用）
 */
export function getModularPromptHome(): string {
  if (process.env.MODULAR_PROMPT_HOME) {
    return process.env.MODULAR_PROMPT_HOME;
  }
  return path.join(os.homedir(), MODULAR_PROMPT_DIR);
}

export function getRuntimesRoot(): string {
  return path.join(getModularPromptHome(), 'runtimes');
}

export function getRuntimeDir(profile: RuntimeProfile): string {
  return path.join(getRuntimesRoot(), profile);
}

export function getVenvPath(profile: RuntimeProfile): string {
  return path.join(getRuntimeDir(profile), '.venv');
}

export function getManifestPath(profile: RuntimeProfile): string {
  return path.join(getRuntimeDir(profile), 'manifest.json');
}

/**
 * @modular-prompt/driver パッケージルート（dist/ または packages/driver/）
 */
export function resolvePackageRoot(fromDir: string): string {
  return path.resolve(fromDir, '..', '..', '..');
}

/**
 * MLX Python サーバーのプロジェクトディレクトリ
 */
export function getMlxPythonDir(packageRoot: string): string {
  const distPython = path.join(packageRoot, 'mlx-ml', 'python');
  if (existsSync(distPython)) {
    return distPython;
  }
  return path.join(packageRoot, 'src', 'mlx-ml', 'python');
}

/** dist/mlx-ml/process からパッケージルートを解決 */
export function resolvePackageRootFromProcessModule(importMetaUrl: string): string {
  const moduleDir = path.dirname(fileURLToPath(importMetaUrl));
  return resolvePackageRoot(moduleDir);
}

