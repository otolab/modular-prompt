/**
 * CLI / profile からローカル推論ドライバーを解決する
 */

import type { DriverProvider, MlxBackendMode, MlxModelDriverOptions } from '@modular-prompt/driver';
import type { DialogProfile } from './types.js';

/** simple-chat で選択可能なドライバー種別 */
export type ChatDriverKind = 'mlx' | 'mlx_lm' | 'mlx_vlm' | 'mlx_optiq' | 'pytorch';

const DRIVER_ALIASES: Record<string, ChatDriverKind> = {
  mlx: 'mlx',
  mlx_lm: 'mlx_lm',
  mlx_vlm: 'mlx_vlm',
  mlx_optiq: 'mlx_optiq',
  pytorch: 'pytorch',
};

/** CLI / profile の driver 文字列を正規化して検証する */
export function parseDriverKind(value: string): ChatDriverKind {
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  const kind = DRIVER_ALIASES[normalized];
  if (!kind) {
    throw new Error(
      `Unknown driver: ${value}. Use mlx_lm, mlx_vlm, mlx_optiq, mlx, or pytorch.`,
    );
  }
  return kind;
}

function resolveDriverKind(profile: DialogProfile): ChatDriverKind | null {
  if (profile.driver) {
    return parseDriverKind(profile.driver);
  }
  const modelDriver = profile.workflow?.models?.default?.driver;
  if (modelDriver) {
    return parseDriverKind(modelDriver);
  }
  if (profile.textOnly) {
    return 'mlx_lm';
  }
  return null;
}

function driverKindToSelection(kind: ChatDriverKind): {
  provider: DriverProvider;
  mlxBackend?: MlxBackendMode;
} {
  switch (kind) {
    case 'pytorch':
      return { provider: 'pytorch' };
    case 'mlx_lm':
      return { provider: 'mlx', mlxBackend: 'lm' };
    case 'mlx_vlm':
      return { provider: 'mlx', mlxBackend: 'vlm' };
    case 'mlx_optiq':
      return { provider: 'mlx', mlxBackend: 'optiq' };
    default:
      return { provider: 'mlx', mlxBackend: 'auto' };
  }
}

/** profile から provider と MLX バックエンドを決定する */
export function resolveDriverSelection(profile: DialogProfile): {
  provider: DriverProvider;
  mlxBackend?: MlxBackendMode;
} {
  const kind = resolveDriverKind(profile);
  if (kind) {
    return driverKindToSelection(kind);
  }

  const modelProvider = profile.workflow?.models?.default?.provider;
  if (modelProvider === 'pytorch') {
    return { provider: 'pytorch' };
  }

  return { provider: 'mlx', mlxBackend: 'auto' };
}

/** createDriver 用の MLX driverOptions を組み立てる */
export function buildMlxDriverOptions(
  profile: DialogProfile,
  mlxBackend?: MlxBackendMode,
): MlxModelDriverOptions | undefined {
  const opts: MlxModelDriverOptions = {};

  if (mlxBackend && mlxBackend !== 'auto') {
    opts.backend = mlxBackend;
  } else if (profile.textOnly) {
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
