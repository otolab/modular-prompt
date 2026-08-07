import { mergePyTorchQueryOptions, toPyTorchSamplingOptions } from './pytorch-options.js';
import { createModelSpecificProcessor, selectApi } from '../mlx-ml/process/model-specific.js';
import { selectResponseProcessor } from '../mlx-ml/process/model-handlers.js';
import { generateMergedPrompt } from '../mlx-ml/process/prompt-builder.js';
import { formatToolDefinitionsAsText } from '../mlx-ml/tool-call-parser/index.js';
import {
  convertMessages,
  convertToolDefinitions,
  extractImagePaths,
} from '../mlx-ml/mlx-message-utils.js';
import type { LocalInferenceAdapters } from '../local-inference/adapters.js';

export const pytorchLocalInferenceAdapters: LocalInferenceAdapters = {
  mergeQueryOptions: (defaults, options) =>
    mergePyTorchQueryOptions(defaults, options) as Record<string, unknown>,
  toSamplingOptions: (merged) => toPyTorchSamplingOptions(merged),
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
