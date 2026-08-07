import path from 'path';
import { fileURLToPath } from 'url';
import {
  MODULAR_PROMPT_DIR,
  RUNTIME_PROFILES as RUNTIME_PROFILES_CORE,
  getModularPromptHome,
  getRuntimesRoot,
  getRuntimeDir,
  getVenvPath,
  getManifestPath,
  getMlxPythonDir,
  getPytorchPythonDir,
  isRuntimeReady,
} from './paths-core.mjs';

export {
  MODULAR_PROMPT_DIR,
  getModularPromptHome,
  getRuntimesRoot,
  getRuntimeDir,
  getVenvPath,
  getManifestPath,
  getMlxPythonDir,
  getPytorchPythonDir,
  isRuntimeReady,
};

/** サポートする runtime profile */
export type RuntimeProfile = 'mlx' | 'pytorch';

export const RUNTIME_PROFILES: RuntimeProfile[] = RUNTIME_PROFILES_CORE as RuntimeProfile[];

/**
 * @modular-prompt/driver パッケージルート（dist/ または packages/driver/）
 */
export function resolvePackageRoot(fromDir: string): string {
  return path.resolve(fromDir, '..', '..', '..');
}

/** dist/mlx-ml/process からパッケージルートを解決 */
export function resolvePackageRootFromProcessModule(importMetaUrl: string): string {
  const moduleDir = path.dirname(fileURLToPath(importMetaUrl));
  return resolvePackageRoot(moduleDir);
}
