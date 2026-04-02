/**
 * 統合テスト用ドライバー設定の読み込み
 *
 * test-drivers.yaml が存在する場合のみ設定を返す。
 * 存在しない場合は undefined を返すので、テスト側で skipIf に使う。
 */
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'test-drivers.yaml');

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
    nativeModel?: string;
    fallbackModel?: string;
  };
}

let _config: TestDriversConfig | undefined;
let _loaded = false;

export function loadTestDriversConfig(): TestDriversConfig | undefined {
  if (_loaded) return _config;
  _loaded = true;

  if (!existsSync(CONFIG_PATH)) {
    return undefined;
  }

  const content = readFileSync(CONFIG_PATH, 'utf-8');
  _config = yaml.load(content) as TestDriversConfig;
  return _config;
}

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
