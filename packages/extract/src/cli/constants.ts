import { join } from 'node:path';
import { getModularPromptHome } from '@modular-prompt/driver';

/** キャッシュディレクトリ内のメタデータファイル名。 */
export const MANIFEST_FILENAME = 'manifest.json';

/** `-d` 省略時に使用する cache container のディレクトリ名。 */
export const DEFAULT_CACHE_SUBDIR = 'extract-cache';

/** `-d` 省略時のデフォルト cache container を解決する。 */
export function resolveDefaultContainerDir(): string {
  return join(getModularPromptHome(), DEFAULT_CACHE_SUBDIR);
}

/** create 時のキャッシュ prefill 用 cue（出力は最小限に抑える）。 */
export const CACHE_PREPARE_CUE = '（cache prepare）';

/** `extract --max-tokens` 省略時のデフォルト。 */
export const DEFAULT_MAX_TOKENS = 8000;

/** Environment variable that disables automatic KV cache regeneration. */
export const AUTO_REBUILD_CACHE_ENV = 'MODULAR_PROMPT_EXTRACT_AUTO_REBUILD_CACHE';

/** Resolve the automatic cache rebuild setting with CLI/config precedence. */
export function resolveAutoRebuildCache(configValue?: boolean): boolean {
  if (configValue !== undefined) {
    return configValue;
  }

  const environmentValue = process.env[AUTO_REBUILD_CACHE_ENV];
  if (environmentValue === undefined) {
    return true;
  }

  if (/^(?:0|false|no|off)$/i.test(environmentValue.trim())) {
    return false;
  }
  if (/^(?:1|true|yes|on)$/i.test(environmentValue.trim())) {
    return true;
  }

  throw new Error(
    `${AUTO_REBUILD_CACHE_ENV} must be one of true/false, 1/0, yes/no, or on/off`,
  );
}
