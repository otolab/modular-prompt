/**
 * CLI / profile から provider と MLX backend を解決する
 */

import type { DriverProvider, MlxBackendMode, MlxModelDriverOptions } from '@modular-prompt/driver';
import type { DialogProfile, ModelOverrides } from './types.js';

const MLX_BACKEND_ALIASES: Record<string, MlxBackendMode> = {
  auto: 'auto',
  mlx: 'auto',
  lm: 'lm',
  mlx_lm: 'lm',
  vlm: 'vlm',
  mlx_vlm: 'vlm',
  optiq: 'optiq',
  mlx_optiq: 'optiq',
};

let warnedDeprecatedTextOnly = false;

function warnDeprecatedTextOnly(): void {
  if (warnedDeprecatedTextOnly) {
    return;
  }
  warnedDeprecatedTextOnly = true;
  const message =
    'profile.textOnly / --text-only は非推奨です。代わりに backend: lm を指定してください。';
  if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
    process.emitWarning(message, { code: 'SIMPLE_CHAT_DEPRECATED_TEXT_ONLY' });
  } else {
    console.warn(message);
  }
}

/** MLX backend 文字列を正規化して検証する */
export function parseMlxBackend(value: string): MlxBackendMode {
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  const backend = MLX_BACKEND_ALIASES[normalized];
  if (!backend) {
    throw new Error(
      `Unknown backend: ${value}. Use auto, lm, vlm, or optiq.`,
    );
  }
  return backend;
}

/** provider 文字列を検証する */
export function parseProvider(value: string): DriverProvider {
  const normalized = value.trim().toLowerCase() as DriverProvider;
  const allowed: DriverProvider[] = [
    'mlx',
    'pytorch',
    'openai',
    'anthropic',
    'vertexai',
    'googlegenai',
    'ollama',
    'vllm',
    'echo',
    'test',
  ];
  if (!allowed.includes(normalized)) {
    throw new Error(`Unknown provider: ${value}`);
  }
  return normalized;
}

function resolveMlxBackend(
  profile: DialogProfile,
  overrides?: ModelOverrides,
): MlxBackendMode | undefined {
  if (overrides?.backend) {
    return parseMlxBackend(overrides.backend);
  }
  if (profile.backend) {
    return parseMlxBackend(profile.backend);
  }
  const modelBackend = profile.workflow?.models?.default?.backend;
  if (modelBackend) {
    return parseMlxBackend(modelBackend);
  }
  if (overrides?.textOnly || profile.textOnly) {
    warnDeprecatedTextOnly();
    return 'lm';
  }
  return undefined;
}

function resolveExplicitProvider(
  profile: DialogProfile,
  overrides?: ModelOverrides,
): DriverProvider | undefined {
  if (overrides?.provider) {
    return overrides.provider;
  }
  if (profile.provider) {
    return parseProvider(profile.provider);
  }
  return undefined;
}

/** profile と override から provider と MLX backend を決定する */
export function resolveInferenceSelection(
  profile: DialogProfile,
  overrides?: ModelOverrides,
): {
  provider?: DriverProvider;
  mlxBackend?: MlxBackendMode;
} {
  return {
    provider: resolveExplicitProvider(profile, overrides),
    mlxBackend: resolveMlxBackend(profile, overrides),
  };
}

/** createDriver 用の MLX driverOptions を組み立てる */
export function buildMlxDriverOptions(
  profile: DialogProfile,
  mlxBackend?: MlxBackendMode,
  overrides?: ModelOverrides,
): MlxModelDriverOptions | undefined {
  const opts: MlxModelDriverOptions = {};

  if (mlxBackend && mlxBackend !== 'auto') {
    opts.backend = mlxBackend;
  } else if (overrides?.textOnly || profile.textOnly) {
    warnDeprecatedTextOnly();
    opts.backend = 'lm';
  }

  if (profile.drafterModel) {
    opts.drafterModel = profile.drafterModel;
  }
  if (profile.draftBlockSize !== undefined) {
    opts.draftBlockSize = profile.draftBlockSize;
  }
  if (profile.cacheDir) {
    opts.cacheDir = profile.cacheDir;
  }

  return Object.keys(opts).length > 0 ? opts : undefined;
}
