/** キャッシュディレクトリ内のメタデータファイル名。 */
export const MANIFEST_FILENAME = 'manifest.json';

/** `create -d` 省略時のデフォルト（カレントディレクトリ直下）。 */
export const DEFAULT_CACHE_DIR = '.extract-cache';

/** create 時のキャッシュ prefill 用 cue（出力は最小限に抑える）。 */
export const CACHE_PREPARE_CUE = '（cache prepare）';

/** `extract --max-tokens` 省略時のデフォルト。 */
export const DEFAULT_MAX_TOKENS = 8000;
