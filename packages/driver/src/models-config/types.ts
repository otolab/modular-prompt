/**
 * ~/.modular-prompt/models.yaml スキーマ型
 */

import type { ApplicationConfig } from '../driver-registry/config-based-factory.js';
import type { DriverCapability, DriverProvider, ModelSpec } from '../driver-registry/types.js';

/** models セクションのマージモード */
export type ModelsMergeMode = 'merge' | 'override';

/** 利用側が明示投入する overlay とマージモード */
export interface ModelsConfigOptions {
  /** models セクションのマージモード（デフォルト: merge） */
  mode?: ModelsMergeMode;
  /** 利用側 overlay（未指定ならユーザーデフォルトのみ） */
  overlay?: ModelsConfig;
}

/** YAML 上のモデルエントリ（alias は親 Record のキー） */
export interface ModelSpecEntry {
  model: string;
  provider: DriverProvider | string;
  capabilities?: DriverCapability[];
  runtime?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  tokensPerMinute?: number;
  requestsPerMinute?: number;
  cost?: ModelSpec['cost'];
  priority?: number;
  disabled?: boolean;
  defaultOptions?: ModelSpec['defaultOptions'];
  driverOptions?: ModelSpec['driverOptions'];
  metadata?: Record<string, unknown>;
}

/** models.yaml のルート構造 */
export interface ModelsConfig {
  /** runtime profile 名 → デフォルト model 文字列 */
  defaults?: Record<string, string>;
  /** alias → ModelSpec エントリ */
  models?: Record<string, ModelSpecEntry>;
  drivers?: ApplicationConfig['drivers'];
  defaultOptions?: ApplicationConfig['defaultOptions'];
}

/** workflow / inline からのモデル参照 */
export interface ModelReferenceInput {
  /** models.yaml の alias */
  ref?: string;
  provider?: string;
  model?: string;
  runtime?: string;
}
