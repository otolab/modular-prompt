/**
 * models.yaml のパス解決
 */

import path from 'path';
import { getModularPromptHome } from '../runtime/paths-core.mjs';

export const MODELS_CONFIG_FILENAME = 'models.yaml';

/** ユーザーレベル: ~/.modular-prompt/models.yaml */
export function getUserModelsConfigPath(): string {
  return path.join(getModularPromptHome(), MODELS_CONFIG_FILENAME);
}
