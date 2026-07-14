import type { QueryOptions } from '../types.js';
import type { MlxMlModelOptions } from './types.js';

/** MLX 固有のサンプリングパラメータ（QueryOptions に無いもの） */
export type MlxSamplingExtras = Pick<
  MlxMlModelOptions,
  'repetitionPenalty' | 'repetitionContextSize' | 'trustRemoteCode'
>;

/**
 * MLX ドライバーのクエリオプション。
 * 共通 QueryOptions + MLX 固有サンプリング。Python 層には toMlxSamplingOptions で変換して渡す。
 */
export type MlxQueryOptions = QueryOptions & Partial<MlxSamplingExtras>;

const MLX_SAMPLING_KEYS = [
  'maxTokens',
  'temperature',
  'topP',
  'topK',
  'repetitionPenalty',
  'repetitionContextSize',
  'trustRemoteCode',
] as const satisfies readonly (keyof MlxMlModelOptions)[];

/**
 * defaultOptions と per-query オプションをマージする（他ドライバーと同じパターン）。
 */
export function mergeMlxQueryOptions(
  defaults?: Partial<MlxQueryOptions>,
  overrides?: QueryOptions,
): MlxQueryOptions {
  return { ...defaults, ...overrides };
}

/**
 * マージ済み QueryOptions から Python 向けサンプリングパラメータのみ抽出する。
 * mode / apiStrategy / tools / signal / cache 等は含めない。
 */
export function toMlxSamplingOptions(merged: Partial<MlxQueryOptions>): MlxMlModelOptions {
  const result: MlxMlModelOptions = {};
  for (const key of MLX_SAMPLING_KEYS) {
    const value = merged[key];
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
