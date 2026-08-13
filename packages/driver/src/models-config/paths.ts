/**
 * models.yaml のパス解決
 */

import path from 'path';
import { MODULAR_PROMPT_DIR, getModularPromptHome } from '../runtime/paths-core.mjs';

export const MODELS_CONFIG_FILENAME = 'models.yaml';

/** ユーザーレベル: ~/.modular-prompt/models.yaml */
export function getUserModelsConfigPath(): string {
  return path.join(getModularPromptHome(), MODELS_CONFIG_FILENAME);
}

/** プロジェクトローカル: {projectRoot}/.modular-prompt/models.yaml */
export function getProjectModelsConfigPath(projectRoot: string): string {
  return path.join(projectRoot, MODULAR_PROMPT_DIR, MODELS_CONFIG_FILENAME);
}
