import {
  mergeMlxQueryOptions,
  toMlxSamplingOptions,
  type MlxQueryOptions,
} from './mlx-options.js';
import { createModelSpecificProcessor, selectApi } from './process/model-specific.js';
import { selectResponseProcessor } from './process/model-handlers.js';
import { generateMergedPrompt } from './process/prompt-builder.js';
import { formatToolDefinitionsAsText } from './tool-call-parser/index.js';
import {
  convertMessages,
  convertToolDefinitions,
  extractImagePaths,
} from './mlx-message-utils.js';
import type { LocalInferenceAdapters } from '../local-inference/adapters.js';

export const mlxLocalInferenceAdapters: LocalInferenceAdapters = {
  mergeQueryOptions: (defaults, options) =>
    mergeMlxQueryOptions(
      defaults as Partial<MlxQueryOptions>,
      options as Partial<MlxQueryOptions> | undefined,
    ) as Record<string, unknown>,
  toSamplingOptions: (merged) => toMlxSamplingOptions(merged) as Record<string, unknown>,
  createModelProcessor: (model) => createModelSpecificProcessor(model),
  selectResponseProcessor: (model, runtimeInfo, opts) =>
    selectResponseProcessor(model, runtimeInfo, opts),
  convertToolDefinitions,
  convertMessages,
  extractImagePaths,
  formatToolDefinitionsAsText,
  generateMergedPrompt,
  selectApi,
};
