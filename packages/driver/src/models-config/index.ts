/**
 * ~/.modular-prompt/models.yaml 読み込み・解決
 */

export {
  loadModelsConfigFile,
  normalizeModelsConfig,
  normalizeModelsSection,
} from './loader.js';

export {
  mergeModelsConfig,
  loadUserModelsConfig,
  resolveModelsConfig,
  toApplicationConfig,
  entryToModelSpec,
  resolveModelAlias,
  resolveModelReference,
  resolveDefaultModel,
  buildApplicationConfig,
  registerModelsFromConfig,
} from './resolve.js';

export {
  MODELS_CONFIG_FILENAME,
  getUserModelsConfigPath,
  getProjectModelsConfigPath,
} from './paths.js';

export type {
  ModelsMergeMode,
  ModelsConfigOptions,
  ModelSpecEntry,
  ModelsConfig,
  ModelReferenceInput,
} from './types.js';
