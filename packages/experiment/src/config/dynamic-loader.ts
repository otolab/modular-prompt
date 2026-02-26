/**
 * Dynamic loader for evaluators and modules
 *
 * Loads evaluators and modules from external files or inline definitions
 */

import { merge } from '@modular-prompt/core';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import type {
  EvaluatorReference,
  CodeEvaluator,
  PromptEvaluator,
  ModuleDefinition,
} from '../types.js';
import { baseEvaluationModule } from '../base-evaluation-module.js';
import { getBuiltinEvaluator } from '../evaluators/index.js';
import { logger as baseLogger } from '../logger.js';

const logger = baseLogger.context('dynamic-loader');

/**
 * Loaded evaluator (unified type)
 */
export interface LoadedEvaluator {
  name: string;
  description: string;
  type: 'code' | 'prompt';
  codeEvaluator?: CodeEvaluator;
  promptEvaluator?: PromptEvaluator;
}

/**
 * Load evaluators from references
 *
 * @param refs - Array of evaluator references
 * @param basePath - Base path for resolving relative paths
 * @returns Array of loaded evaluators
 */
export async function loadEvaluators(
  refs: EvaluatorReference[],
  basePath: string
): Promise<LoadedEvaluator[]> {
  const evaluators: LoadedEvaluator[] = [];

  for (const ref of refs) {
    let evaluator: CodeEvaluator | PromptEvaluator | undefined;

    if ('path' in ref) {
      // External file
      const filePath = resolve(basePath, ref.path);
      const fileUrl = pathToFileURL(filePath).href;
      const imported = await import(fileUrl);
      evaluator = imported.default;

      if (!evaluator) {
        logger.warn(`No default export in ${ref.path}`);
        continue;
      }
    } else if ('prompt' in ref) {
      // Inline prompt definition - merge with base module
      const mergedModule = merge(baseEvaluationModule, ref.prompt);
      evaluators.push({
        name: ref.name,
        description: ref.description || '',
        type: 'prompt',
        promptEvaluator: {
          name: ref.name,
          description: ref.description || '',
          module: mergedModule,
        },
      });
      continue;
    } else {
      // Builtin evaluator (name only)
      evaluator = getBuiltinEvaluator(ref.name);

      if (!evaluator) {
        logger.warn(`Builtin evaluator not found: ${ref.name}`);
        continue;
      }
    }

    // Detect type by checking properties
    if ('evaluate' in evaluator && typeof evaluator.evaluate === 'function') {
      // Code evaluator
      evaluators.push({
        name: ref.name,
        description: ref.description || evaluator.description || '',
        type: 'code',
        codeEvaluator: evaluator as CodeEvaluator,
      });
    } else if ('module' in evaluator) {
      // Prompt evaluator - merge with base module
      const mergedModule = merge(baseEvaluationModule, evaluator.module);
      evaluators.push({
        name: ref.name,
        description: ref.description || evaluator.description || '',
        type: 'prompt',
        promptEvaluator: {
          name: evaluator.name,
          description: evaluator.description,
          module: mergedModule,
        },
      });
    } else {
      logger.warn(`Unknown evaluator type: ${ref.name}`);
    }
  }

  return evaluators;
}

/**
 * Module reference in config file
 */
export type ModuleReference =
  | { name: string; path: string; description?: string };

/**
 * Load modules from references
 *
 * @param refs - Array of module references
 * @param basePath - Base path for resolving relative paths
 * @returns Array of module definitions
 */
export async function loadModules(
  refs: ModuleReference[],
  basePath: string
): Promise<ModuleDefinition[]> {
  const modules: ModuleDefinition[] = [];

  for (const ref of refs) {
    const filePath = resolve(basePath, ref.path);
    const fileUrl = pathToFileURL(filePath).href;
    const imported = await import(fileUrl);
    const module = imported.default;

    if (!module) {
      logger.warn(`No default export in ${ref.path}`);
      continue;
    }

    modules.push({
      name: ref.name,
      description: ref.description || '',
      module: module,
    });
  }

  return modules;
}
