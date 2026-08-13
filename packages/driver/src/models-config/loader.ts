/**
 * models.yaml の読み込み
 */

import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import type { ModelSpecEntry, ModelsConfig } from './types.js';

/**
 * YAML ファイルを読み込んで ModelsConfig に変換する。
 * ファイルが存在しない場合は null。
 */
export function loadModelsConfigFile(configPath: string): ModelsConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  const content = readFileSync(configPath, 'utf-8');
  const raw = yaml.load(content) as Record<string, unknown> | null;

  if (!raw || typeof raw !== 'object') {
    return {};
  }

  return normalizeModelsConfig(raw);
}

/**
 * 生の YAML オブジェクトを ModelsConfig に正規化する
 */
export function normalizeModelsConfig(raw: Record<string, unknown>): ModelsConfig {
  const config: ModelsConfig = {};

  if (raw.defaults && typeof raw.defaults === 'object') {
    config.defaults = raw.defaults as Record<string, string>;
  }

  if (raw.drivers && typeof raw.drivers === 'object') {
    config.drivers = raw.drivers as ModelsConfig['drivers'];
  }

  if (raw.defaultOptions && typeof raw.defaultOptions === 'object') {
    config.defaultOptions = raw.defaultOptions as ModelsConfig['defaultOptions'];
  }

  if (raw.models !== undefined) {
    config.models = normalizeModelsSection(raw.models);
  }

  return config;
}

/**
 * models セクションを Record\<alias, ModelSpecEntry\> に正規化
 * - Record 形式: そのまま
 * - 配列形式: `id` フィールドを alias に使用
 */
export function normalizeModelsSection(
  models: unknown
): Record<string, ModelSpecEntry> {
  if (!models) {
    return {};
  }

  if (Array.isArray(models)) {
    const result: Record<string, ModelSpecEntry> = {};
    for (const entry of models) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== 'string' || !id) {
        continue;
      }
      const rest = { ...record };
      delete rest.id;
      result[id] = rest as unknown as ModelSpecEntry;
    }
    return result;
  }

  if (typeof models === 'object') {
    return models as Record<string, ModelSpecEntry>;
  }

  return {};
}
