/**
 * Configuration loader
 */

import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { resolve, dirname, extname } from 'path';
import { createJiti } from 'jiti';
import { AIService, type ApplicationConfig } from '@modular-prompt/driver';
import type { ModuleReference } from './dynamic-loader.js';
import type { EvaluatorReference, TestCase } from '../types.js';
import { logger as baseLogger } from '../logger.js';

const logger = baseLogger.context('config-loader');

export interface LoadedConfig {
  serverConfig: any;
  modules: ModuleReference[];
  testCases: TestCase[];
  evaluators: EvaluatorReference[];
  aiService: AIService;
  configDir: string;
}

// For backward compatibility
export type ExperimentConfig = LoadedConfig;

/**
 * Resolve path relative to config file directory
 *
 * @param configDir - Config file directory
 * @param path - Path to resolve (can be relative or absolute)
 * @returns Resolved absolute path
 */
function resolveConfigPath(configDir: string, path: string): string {
  // If path starts with ~, resolve it as home directory
  if (path.startsWith('~')) {
    return path.replace('~', process.env.HOME || '~');
  }
  // If path is absolute, return as is
  if (path.startsWith('/')) {
    return path;
  }
  // Otherwise, resolve relative to config directory
  return resolve(configDir, path);
}


/**
 * Load experiment configuration
 *
 * @param configPath - Path to config file (YAML or TypeScript)
 * @returns LoadedConfig with all configuration
 */
export async function loadExperimentConfig(configPath: string): Promise<LoadedConfig> {
  // Get config directory and file extension
  const configDir = dirname(configPath);
  const ext = extname(configPath);

  // Load config based on file type
  let config: any;

  if (ext === '.yaml' || ext === '.yml') {
    // YAML format
    const content = readFileSync(configPath, 'utf-8');
    config = parseYaml(content);
  } else if (ext === '.ts' || ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    // TypeScript/JavaScript format (auto-transpile with jiti)
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,  // Automatically get default export
      cache: true,           // Enable caching for better performance
      requireCache: false,   // Don't use require cache
    });

    config = await jiti.import(configPath);

    if (!config) {
      throw new Error(`❌ No default export in ${configPath}`);
    }
  } else {
    throw new Error(`❌ Unsupported config file format: ${ext}. Use .yaml, .yml, .ts, .js, .mjs, or .cjs`);
  }

  // Extract components
  const modules: ModuleReference[] = config.modules || [];
  const testCases: TestCase[] = config.testCases || [];
  const evaluators: EvaluatorReference[] = config.evaluators || [];

  // Server config (models, drivers, evaluation, etc.)
  const serverConfig = {
    models: config.models,
    drivers: config.drivers,
    evaluation: config.evaluation,
    credentials: config.credentials,
  };

  // Resolve paths in driver configurations relative to config file
  if (serverConfig.drivers) {
    for (const driverName in serverConfig.drivers) {
      const driverConfig = serverConfig.drivers[driverName];

      // Resolve credentialsPath for vertexai driver
      if (driverConfig.credentialsPath) {
        driverConfig.credentialsPath = resolveConfigPath(configDir, driverConfig.credentialsPath);
      }
    }
  }

  // Setup driver environment variables if specified
  if (serverConfig.credentials?.googleApplicationCredentials) {
    const resolvedPath = resolveConfigPath(configDir, serverConfig.credentials.googleApplicationCredentials);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedPath;
    logger.verbose(`Setting GOOGLE_APPLICATION_CREDENTIALS=${resolvedPath}`);
  }

  // Validation
  if (!serverConfig.models || Object.keys(serverConfig.models).length === 0) {
    throw new Error('❌ No models configured in config file');
  }

  // Get model names from object keys
  const modelNames = new Set<string>(Object.keys(serverConfig.models));

  // Validate testCase model references
  for (const testCase of testCases) {
    if (testCase.models) {
      for (const entry of testCase.models) {
        if (typeof entry === 'string') {
          if (!modelNames.has(entry)) {
            throw new Error(`❌ TestCase '${testCase.name}' references unknown model '${entry}'`);
          }
        } else {
          // Inline DriverSet: check all referenced models exist
          for (const [role, refName] of Object.entries(entry)) {
            if (!modelNames.has(refName)) {
              throw new Error(`❌ TestCase '${testCase.name}' references unknown model '${refName}' for role '${role}'`);
            }
          }
        }
      }
    }
  }

  // Initialize AIService
  // Note: AIService is used only as a driver factory.
  // Model selection is explicit in experiment configuration, not capability-based.
  const aiServiceConfig: ApplicationConfig = {
    models: serverConfig.models,
    drivers: serverConfig.drivers || {},
    defaultOptions: {
      temperature: 0.7,
      maxTokens: 2048,
    },
  };

  const aiService = new AIService(aiServiceConfig);

  return {
    serverConfig,
    modules,
    testCases,
    evaluators,
    aiService,
    configDir
  };
}
