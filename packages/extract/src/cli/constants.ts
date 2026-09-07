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
