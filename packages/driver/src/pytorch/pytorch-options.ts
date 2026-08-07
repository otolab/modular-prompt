import type { QueryOptions } from '../types.js';

/** PyTorch ドライバーのクエリオプション（MLX と同型のサンプリング） */
export type PyTorchQueryOptions = QueryOptions & {
  trustRemoteCode?: boolean;
};

const PYTORCH_SAMPLING_KEYS = [
  'maxTokens',
  'temperature',
  'topP',
  'topK',
  'trustRemoteCode',
] as const;

export function mergePyTorchQueryOptions(
  defaults?: Partial<PyTorchQueryOptions>,
  overrides?: QueryOptions,
): PyTorchQueryOptions {
  return { ...defaults, ...overrides };
}

export function toPyTorchSamplingOptions(
  merged: Partial<PyTorchQueryOptions>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of PYTORCH_SAMPLING_KEYS) {
    const value = merged[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
