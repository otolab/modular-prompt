/**
 * 統合テスト用ドライバー設定の読み込み
 *
 * models.testing.yaml または test-drivers.yaml が存在する場合のみ設定を返す。
 * 存在しない場合は undefined を返すので、テスト側で skipIf に使う。
 */
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import {
  getTestingModelsConfigPath,
  resolveModelsConfig,
  type ModelSpecEntry,
  type ModelsConfig,
} from '../../src/models-config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'test-drivers.yaml');

/** ローカル MLX 統合テストのデフォルトモデル（軽量・逐次実行向け） */
const FALLBACK_MLX_TEST_MODEL =
  'prism-ml/Ternary-Bonsai-1.7B-mlx-2bit';

/**
 * test-drivers.yaml の mlx セクションは tool-call 統合テスト専用:
 * - nativeModel: chat_template による native tool call 対応モデル
 * - fallbackModel: テキスト注入方式（native 未サポート）のモデル
 */

export interface TestDriversConfig {
  anthropic?: {
    apiKey?: string;
    model?: string;
    vertex?: {
      project: string;
      location?: string;
    };
  };
  openai?: {
    apiKey?: string;
    model?: string;
    baseURL?: string;
  };
  'google-genai'?: {
    apiKey?: string;
    model?: string;
  };
  vertexai?: {
    project?: string;
    location?: string;
    model?: string;
  };
  mlx?: {
    defaultModel?: string;
    nativeModel?: string;
    fallbackModel?: string;
  };
}

let _config: TestDriversConfig | undefined;
let _loaded = false;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object'
    ? (value as UnknownRecord)
    : undefined;
}

function modelProviderMatches(
  entry: ModelSpecEntry,
  providers: readonly string[]
): boolean {
  return providers.includes(entry.provider.toLowerCase());
}

function findModelEntry(
  config: ModelsConfig,
  providers: readonly string[],
  aliases: readonly string[] = [],
  fallbackToFirst = true
): ModelSpecEntry | undefined {
  const models = config.models ?? {};

  for (const alias of aliases) {
    const entry = models[alias];
    if (entry && !entry.disabled && modelProviderMatches(entry, providers)) {
      return entry;
    }
  }

  if (!fallbackToFirst) {
    return undefined;
  }

  return Object.values(models).find(entry =>
    !entry.disabled && modelProviderMatches(entry, providers)
  );
}

function findDriverConfig(
  config: ModelsConfig,
  names: readonly string[]
): UnknownRecord | undefined {
  const drivers = asRecord(config.drivers);
  if (!drivers) {
    return undefined;
  }

  for (const name of names) {
    const driver = asRecord(drivers[name]);
    if (driver) {
      return driver;
    }
  }

  return undefined;
}

function deriveProviderConfig(
  config: ModelsConfig,
  providers: readonly string[],
  driverNames: readonly string[]
): UnknownRecord | undefined {
  const driver = findDriverConfig(config, driverNames);
  const model = findModelEntry(config, providers)?.model;

  if (!driver && !model) {
    return undefined;
  }

  return {
    ...(driver ?? {}),
    ...(model ? { model } : {}),
  };
}

/**
 * models.testing.yaml の models/drivers を既存統合テスト設定へ変換する。
 * MLX は convention alias を優先し、alias が無ければ provider が mlx の
 * 最初の有効モデルをデフォルトモデルとして使用する。
 */
export function deriveTestDriversConfig(
  config: ModelsConfig
): TestDriversConfig {
  const derived: TestDriversConfig = {};
  const mlxNative = findModelEntry(config, ['mlx'], [
    'mlx-native-tool',
  ], false);
  const mlxFallback = findModelEntry(config, ['mlx'], [
    'mlx-fallback-tool',
  ], false);
  const mlxDefault =
    findModelEntry(config, ['mlx'], ['default'], false) ??
    mlxNative ??
    mlxFallback ??
    findModelEntry(config, ['mlx']);

  if (mlxDefault || mlxNative || mlxFallback) {
    derived.mlx = {
      defaultModel: (mlxDefault ?? mlxNative ?? mlxFallback)?.model,
      nativeModel: mlxNative?.model,
      fallbackModel: mlxFallback?.model,
    };
  }

  const anthropic = deriveProviderConfig(
    config,
    ['anthropic'],
    ['anthropic']
  );
  if (anthropic) {
    derived.anthropic = anthropic as TestDriversConfig['anthropic'];
  }

  const openai = deriveProviderConfig(config, ['openai'], ['openai']);
  if (openai) {
    derived.openai = openai as TestDriversConfig['openai'];
  }

  const googleGenAI = deriveProviderConfig(
    config,
    ['google-genai', 'googlegenai'],
    ['google-genai', 'googlegenai']
  );
  if (googleGenAI) {
    derived['google-genai'] = googleGenAI as TestDriversConfig['google-genai'];
  }

  const vertexAI = deriveProviderConfig(config, ['vertexai'], ['vertexai']);
  if (vertexAI) {
    derived.vertexai = vertexAI as TestDriversConfig['vertexai'];
  }

  return derived;
}

function loadModelsTestingConfig(): TestDriversConfig | undefined {
  if (!existsSync(getTestingModelsConfigPath())) {
    return undefined;
  }

  const resolved = resolveModelsConfig({ profile: 'testing' });
  const derived = deriveTestDriversConfig(resolved);
  return Object.keys(derived).length > 0 ? derived : undefined;
}

export function loadTestDriversConfig(): TestDriversConfig | undefined {
  if (_loaded) return _config;
  _loaded = true;

  const testingConfig = loadModelsTestingConfig();
  if (testingConfig) {
    _config = testingConfig;
    return _config;
  }

  if (!existsSync(CONFIG_PATH)) {
    return undefined;
  }

  const content = readFileSync(CONFIG_PATH, 'utf-8');
  _config = yaml.load(content) as TestDriversConfig;
  return _config;
}

/** models.testing.yaml の設定を優先した MLX テストモデルを返す。 */
export function getDefaultMlxTestModel(): string {
  return loadTestDriversConfig()?.mlx?.defaultModel ?? FALLBACK_MLX_TEST_MODEL;
}

export const DEFAULT_MLX_TEST_MODEL = getDefaultMlxTestModel();

/**
 * 指定ドライバーの設定が存在するか
 */
export function hasDriverConfig(driver: keyof TestDriversConfig): boolean {
  const config = loadTestDriversConfig();
  return config != null && config[driver] != null;
}

/**
 * 指定ドライバーの設定を取得
 */
export function getDriverConfig<K extends keyof TestDriversConfig>(
  driver: K
): NonNullable<TestDriversConfig[K]> | undefined {
  const config = loadTestDriversConfig();
  return config?.[driver] as NonNullable<TestDriversConfig[K]> | undefined;
}
