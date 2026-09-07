/**
 * models.yaml のパス解決
 */

import path from 'path';
import { getModularPromptHome } from '../runtime/paths-core.mjs';

export const MODELS_CONFIG_FILENAME = 'models.yaml';
export const TESTING_MODELS_CONFIG_PROFILE = 'testing';

/**
 * ユーザーレベルの models 設定パスを profile から解決する。
 * `default`（または省略時）は既存の models.yaml を使用する。
 */
export function getModelsConfigPath(profile?: string): string {
  const filename =
    !profile || profile === 'default'
      ? MODELS_CONFIG_FILENAME
      : `models.${profile}.yaml`;
  return path.join(getModularPromptHome(), filename);
}

/** ユーザーレベル: ~/.modular-prompt/models.yaml */
export function getUserModelsConfigPath(): string {
  return getModelsConfigPath();
}

/** ユーザーレベル: ~/.modular-prompt/models.testing.yaml */
export function getTestingModelsConfigPath(): string {
  return getModelsConfigPath(TESTING_MODELS_CONFIG_PROFILE);
}
