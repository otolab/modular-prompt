/**
 * ~/.modular-prompt/models.yaml スキーマ型
 */

import type { ApplicationConfig } from '../driver-registry/config-based-factory.js';
import type { DriverCapability, DriverProvider, ModelSpec } from '../driver-registry/types.js';

/** models セクションのマージモード */
export type ModelsMergeMode = 'merge' | 'override';

/**
 * user models.yaml の読み込み方
 * - merge: user yaml を読み込み base / overlay とマージ（デフォルト）
 * - overlay: user yaml を無視し base / overlay のみ使用
 */
export type ModelsConfigSource = 'merge' | 'overlay';

/** 利用側が明示投入する overlay とマージモード */
export interface ModelsConfigOptions {
  /**
   * user yaml の読み込み方（デフォルト: merge）
   * overlay を指定したとき、user 全域 config を無視する場合は overlay を使う
   */
  source?: ModelsConfigSource;
  /** アプリ同梱など、user より下のレイヤー */
  base?: ModelsConfig;
  /** 利用側 overlay（profile.modelsConfig 等） */
  overlay?: ModelsConfig;
  /** models セクションのマージモード（デフォルト: merge） */
  mode?: ModelsMergeMode;
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
}
