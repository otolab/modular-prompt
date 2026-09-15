/**
 * models.yaml のマージ・解決
 */

import type { DriverRegistry } from '../driver-registry/registry.js';
import type { ApplicationConfig } from '../driver-registry/config-based-factory.js';
import type { DriverProvider, ModelSpec } from '../driver-registry/types.js';
import { loadModelsConfigFile } from './loader.js';
import { getModelsConfigPath, getUserModelsConfigPath } from './paths.js';
import type {
  ModelReferenceInput,
  ModelSpecEntry,
  ModelsConfig,
  ModelsConfigOptions,
  ModelsMergeMode,
} from './types.js';

function shallowMergeRecords<T extends Record<string, unknown>>(
  base: T | undefined,
  overlay: T | undefined
): T | undefined {
  if (!base && !overlay) {
    return undefined;
  }
  return { ...(base ?? {}), ...(overlay ?? {}) } as T;
}

function mergeModelsSection(
  base: Record<string, ModelSpecEntry> | undefined,
  overlay: Record<string, ModelSpecEntry> | undefined,
  mode: ModelsMergeMode
): Record<string, ModelSpecEntry> | undefined {
  if (!base && !overlay) {
    return undefined;
  }

  if (mode === 'override' && overlay) {
    return { ...overlay };
  }

  return { ...(base ?? {}), ...(overlay ?? {}) };
}

/**
 * 2 つの ModelsConfig を shallow merge する（overlay 優先）
 */
export function mergeModelsConfig(
  base: ModelsConfig | null | undefined,
  overlay: ModelsConfig | null | undefined,
  mode: ModelsMergeMode = 'merge'
): ModelsConfig {
  const merged: ModelsConfig = {};

  merged.drivers = shallowMergeRecords(base?.drivers, overlay?.drivers);
  merged.defaultOptions = shallowMergeRecords(
    base?.defaultOptions,
    overlay?.defaultOptions
  );

  const baseModels = base?.models;
  const overlayModels = overlay?.models;

  merged.models = mergeModelsSection(baseModels, overlayModels, mode);

  return merged;
}

/**
 * ユーザーレベルの models.yaml を読み込む（存在しない場合は空）
 */
export function loadUserModelsConfig(profile?: string): ModelsConfig {
  const config = loadModelsConfigFile(getUserModelsConfigPath()) ?? {};
  const resolvedProfile = resolveModelsProfile(profile);

  if (!resolvedProfile || resolvedProfile === 'default') {
    return config;
  }

  return mergeModelsConfig(
    config,
    loadModelsConfigFile(getModelsConfigPath(resolvedProfile)),
    'merge'
  );
}

/**
 * 明示 profile、環境変数、実行コンテキストの順に user profile を解決する。
 * Vitest / NODE_ENV=test では testing profile を自動的に追加する。
 */
function resolveModelsProfile(profile?: string): string | undefined {
  if (profile !== undefined) {
    return profile;
  }

  if (process.env.MODULAR_PROMPT_MODELS_PROFILE) {
    return process.env.MODULAR_PROMPT_MODELS_PROFILE;
  }

  if (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)) {
    return 'testing';
  }

  return undefined;
}

/**
 * base / user / overlay を解決する
 *
 * マージ優先（下ほど高）: base → user（source=merge のとき）→ overlay
 */
export function resolveModelsConfig(options?: ModelsConfigOptions): ModelsConfig {
  if (!options) {
    return loadUserModelsConfig();
  }

  const source = options.source ?? 'merge';
  const mode = options.mode ?? 'merge';

  let config: ModelsConfig = options.base ? { ...options.base } : {};

  if (source === 'merge') {
    config = mergeModelsConfig(
      config,
      loadUserModelsConfig(options.profile),
      mode
    );
  }

  if (options.overlay) {
    config = mergeModelsConfig(config, options.overlay, mode);
  }

  return config;
}

/**
 * ModelsConfig を ApplicationConfig に変換する
 */
export function toApplicationConfig(config: ModelsConfig): ApplicationConfig {
  const models = config.models
    ? Object.values(config.models).map(entryToModelSpec)
    : undefined;

  return {
    models,
    drivers: config.drivers,
    defaultOptions: config.defaultOptions,
  };
}

/**
 * ModelSpecEntry を ModelSpec に変換（runtime は metadata に保持）
 */
export function entryToModelSpec(entry: ModelSpecEntry): ModelSpec {
  const metadata = { ...(entry.metadata ?? {}) };
  if (entry.runtime) {
    metadata.runtime = entry.runtime;
  }

  return {
    model: entry.model,
    provider: entry.provider as DriverProvider,
    backend: entry.backend,
    capabilities: entry.capabilities ?? [],
    maxInputTokens: entry.maxInputTokens,
    maxOutputTokens: entry.maxOutputTokens,
    maxTotalTokens: entry.maxTotalTokens,
    tokensPerMinute: entry.tokensPerMinute,
    requestsPerMinute: entry.requestsPerMinute,
    cost: entry.cost,
    priority: entry.priority,
    disabled: entry.disabled,
    defaultOptions: entry.defaultOptions,
    driverOptions: entry.driverOptions,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/**
 * alias から ModelSpec を解決する
 */
export function resolveModelAlias(
  alias: string,
  config: ModelsConfig
): ModelSpec | null {
  const entry = config.models?.[alias];
  if (!entry) {
    return null;
  }
  return entryToModelSpec(entry);
}

const DRIVER_PROVIDERS: readonly DriverProvider[] = [
  'openai',
  'anthropic',
  'vertexai',
  'googlegenai',
  'mlx',
  'pytorch',
  'ollama',
  'vllm',
  'echo',
  'test',
];

function normalizeProvider(value: unknown): DriverProvider | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return DRIVER_PROVIDERS.includes(normalized as DriverProvider)
    ? normalized as DriverProvider
    : undefined;
}

function inferProviderFromRuntime(runtime: unknown): DriverProvider | undefined {
  if (typeof runtime !== 'string') {
    return undefined;
  }

  const normalized = runtime.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'mlx' || normalized.startsWith('mlx-')) {
    return 'mlx';
  }
  if (
    normalized === 'pytorch'
    || normalized.startsWith('pytorch-')
    || normalized === 'torch'
    || normalized.startsWith('torch-')
  ) {
    return 'pytorch';
  }

  return normalizeProvider(normalized);
}

function inferProviderFromModelName(model: string): DriverProvider | undefined {
  // MLX model repositories commonly use either the mlx-community namespace or
  // an `-mlx-` / `-mlx` marker in the model name.
  if (/(?:^|[\\/_-])mlx(?:[\\/_-]|$)/i.test(model)) {
    return 'mlx';
  }
  return undefined;
}

function providerInferenceError(model: string, ambiguous = false): Error {
  const qualifier = ambiguous ? ' uniquely' : '';
  return new Error(
    `Unable to infer provider${qualifier} for model '${model}'. `
    + 'Specify --provider <provider>, use a model alias, '
    + 'or configure a single provider for this model in models.yaml.',
  );
}

/**
 * 生 model ID から driver provider を推論する。
 *
 * alias の解決は呼び出し側の `resolveModelName()` が先に行う。この helper
 * は生 ID に対して、merged models の一致エントリ、runtime metadata、
 * モデル名の既知パターンの順に推論し、判断できない場合は明示指定を促す。
 */
export function inferProvider(
  model: string,
  config: ModelsConfig = {}
): DriverProvider {
  // Keep the test/echo shortcuts stable for local and unit-test drivers.
  if (model.startsWith('test-')) {
    return 'test';
  }
  if (model.startsWith('echo-')) {
    return 'echo';
  }

  const matchingEntries = Object.values(config.models ?? {})
    .filter(entry => entry.model === model);
  if (matchingEntries.length > 0) {
    const matchingProviders = matchingEntries.map(entry =>
      normalizeProvider(entry.provider)
      ?? inferProviderFromRuntime(entry.runtime)
      ?? inferProviderFromRuntime(entry.metadata?.runtime)
    );
    const uniqueProviders = new Set(
      matchingProviders.filter(
        (provider): provider is DriverProvider => provider !== undefined,
      ),
    );

    // More than one exact entry is valid only when every entry resolves to the
    // same provider. An unresolved entry could hide another provider, so do not
    // let its position in the config decide the result.
    if (
      uniqueProviders.size > 1
      || (matchingEntries.length > 1
        && matchingProviders.some(provider => provider === undefined))
    ) {
      throw providerInferenceError(model, true);
    }

    if (uniqueProviders.size === 1 && matchingProviders.every(Boolean)) {
      return [...uniqueProviders][0];
    }
  }

  const modelNameProvider = inferProviderFromModelName(model);
  if (modelNameProvider) {
    return modelNameProvider;
  }

  throw providerInferenceError(model);
}

/**
 * モデル名を alias または生の model 名として解決する
 */
export function resolveModelName(
  name: string,
  config: ModelsConfig,
  providerResolver: (model: string, config: ModelsConfig) => DriverProvider = inferProvider
): ModelSpec {
  const byAlias = resolveModelAlias(name, config);
  if (byAlias) {
    return byAlias;
  }

  return {
    model: name,
    provider: providerResolver(name, config),
    capabilities: [],
  };
}

/**
 * merged models からデフォルト ModelSpec を導出する
 *
 * 1. alias `default` があればそれを使用
 * 2. なければ models の先頭エントリ（best-effort）
 */
export function resolveDefaultModelFromConfig(
  config: ModelsConfig
): ModelSpec | null {
  if (config.models?.default) {
    return entryToModelSpec(config.models.default);
  }

  const entries = Object.entries(config.models ?? {});
  if (entries.length === 0) {
    return null;
  }

  const [, first] = entries[0];
  return entryToModelSpec(first);
}

/**
 * ModelReferenceInput を ModelSpec に解決する
 */
export function resolveModelReference(
  ref: ModelReferenceInput,
  config: ModelsConfig
): ModelSpec | null {
  if (ref.ref) {
    const spec = resolveModelAlias(ref.ref, config);
    if (!spec) {
      return null;
    }
    if (ref.provider) {
      spec.provider = ref.provider as DriverProvider;
    }
    if (ref.model) {
      spec.model = ref.model;
    }
    return spec;
  }

  if (ref.provider && ref.model) {
    return {
      model: ref.model,
      provider: ref.provider as DriverProvider,
      capabilities: [],
    };
  }

  return null;
}

/**
 * inline 設定（experiment YAML 等）を resolved config にマージして ApplicationConfig を構築
 */
export function buildApplicationConfig(
  resolved: ModelsConfig,
  inline?: Partial<ModelsConfig>,
  inlineMode?: ModelsMergeMode
): ApplicationConfig {
  const merged = inline
    ? mergeModelsConfig(resolved, inline as ModelsConfig, inlineMode ?? 'merge')
    : resolved;
  return toApplicationConfig(merged);
}

/**
 * ModelsConfig の全モデルを DriverRegistry に登録する
 */
export function registerModelsFromConfig(
  registry: DriverRegistry,
  config: ModelsConfig
): void {
  if (!config.models) {
    return;
  }

  for (const entry of Object.values(config.models)) {
    if (entry.disabled) {
      continue;
    }
    registry.registerModel(entryToModelSpec(entry));
  }
}
