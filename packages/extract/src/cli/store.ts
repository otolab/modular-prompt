import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const STORE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const RESERVED_STORE_NAMES = new Set(['create', 'add', 'extract', 'list', 'clean']);

/** Validate a store name used as a single directory component. */
export function validateStorename(storename: string): void {
  if (typeof storename !== 'string' || !STORE_NAME_PATTERN.test(storename)) {
    throw new Error(
      `Invalid storename '${String(storename)}': must match [a-zA-Z0-9][a-zA-Z0-9_-]*`,
    );
  }

  if (RESERVED_STORE_NAMES.has(storename)) {
    throw new Error(`Invalid storename '${storename}': reserved name`);
  }
}

/** Resolve a validated store directory below the container directory. */
export function resolveStoreDir(containerDir: string, storename: string): string {
  validateStorename(storename);
  return join(containerDir, storename);
}

/** Return whether a path already exists, regardless of its file type. */
export async function storeExists(storeDir: string): Promise<boolean> {
  try {
    await stat(storeDir);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** Return whether a store entry is a persisted KV cache file or namespace. */
export function isKvCacheFile(filename: string): boolean {
  return filename.endsWith('.safetensors.zip')
    || filename.endsWith('.pytorch-cache')
    || filename.endsWith('.vlm.safetensors')
    || filename.endsWith('.vlm-vision.safetensors');
}

const CACHE_INDEX_FILENAME = 'cache-index.json';

export type StoreKvCacheIssue =
  | 'missing'
  | 'cache-invalid'
  | 'index-invalid'
  | 'index-entry-missing';

export interface StoreKvCacheStatus {
  /** Whether the store has a cache that can be used by a new extract session. */
  hasKvCache: boolean;
  /** Whether extract should run a full prefill before the user query. */
  needsRebuild: boolean;
  /** Whether the controller can use an indexed cache as an incremental base. */
  hasIncrementalBase: boolean;
  issue?: StoreKvCacheIssue;
}

interface CacheIndexEntry {
  key?: unknown;
  backend?: unknown;
  path?: unknown;
  hint?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVlmCachePath(cachePath: string): boolean {
  return cachePath.split(sep).some((segment) =>
    segment.endsWith('.vlm.safetensors')
    || segment.endsWith('.vlm-vision.safetensors'));
}

async function hasHealthyCacheFile(cachePath: string): Promise<boolean> {
  let cacheStat;
  try {
    cacheStat = await stat(cachePath);
  } catch {
    return false;
  }

  if (cacheStat.isDirectory()) {
    let entries;
    try {
      entries = await readdir(cachePath, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const childPath = join(cachePath, entry.name);
      if (entry.isDirectory() && await hasHealthyCacheFile(childPath)) {
        return true;
      }
      if (entry.isFile() && entry.name.endsWith('.safetensors')) {
        if (await hasHealthyCacheFile(childPath)) {
          return true;
        }
      }
    }
    return false;
  }

  if (!cacheStat.isFile()) {
    return false;
  }

  try {
    const metadata = JSON.parse(await readFile(`${cachePath}.meta.json`, 'utf-8')) as {
      token_count?: unknown;
    };
    return typeof metadata.token_count === 'number' && metadata.token_count > 0;
  } catch {
    return false;
  }
}

async function readCacheIndex(
  storeDir: string,
): Promise<{ present: false } | { present: true; entries?: CacheIndexEntry[] }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(storeDir, CACHE_INDEX_FILENAME), 'utf-8'));
    if (
      !isRecord(parsed)
      || parsed.version !== 1
      || !Array.isArray(parsed.entries)
      || !parsed.entries.every(isRecord)
    ) {
      return { present: true };
    }
    return {
      present: true,
      entries: parsed.entries as CacheIndexEntry[],
    };
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { present: false };
    }
    return { present: true };
  }
}

function resolveIndexedCachePath(
  storeDir: string,
  entry: CacheIndexEntry,
): string | undefined {
  if (typeof entry.key !== 'string' || entry.key.length === 0) {
    return undefined;
  }

  let indexedPath: string;
  if (typeof entry.path === 'string') {
    if (entry.path.startsWith('memory://')) {
      return undefined;
    }
    indexedPath = entry.path;
  } else if (entry.backend === 'pytorch') {
    indexedPath = `${entry.key}.pytorch-cache`;
  } else if (entry.backend === undefined || entry.backend === 'lm') {
    indexedPath = `${entry.key}.safetensors.zip`;
  } else {
    return undefined;
  }

  const resolvedStoreDir = resolve(storeDir);
  const resolvedPath = isAbsolute(indexedPath)
    ? resolve(indexedPath)
    : resolve(resolvedStoreDir, indexedPath);
  const pathFromStore = relative(resolvedStoreDir, resolvedPath);
  if (
    pathFromStore.length === 0
    || pathFromStore === '..'
    || pathFromStore.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  return resolvedPath;
}

async function listRawCachePaths(storeDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(storeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => (entry.isFile() || entry.isDirectory()) && isKvCacheFile(entry.name))
    .map((entry) => join(storeDir, entry.name));
}

/**
 * Inspect the persisted cache without starting a model runtime.
 *
 * A cache-index entry is considered usable only when its referenced cache and
 * token metadata exist.  A store without an index can still be used for an
 * exact cache hit (legacy layout), but it cannot provide an incremental base.
 */
export async function inspectStoreKvCache(storeDir: string): Promise<StoreKvCacheStatus> {
  const rawCachePaths = await listRawCachePaths(storeDir);
  const index = await readCacheIndex(storeDir);

  if (!index.present) {
    const hasHealthyCache = (await Promise.all(
      rawCachePaths.map((cachePath) => hasHealthyCacheFile(cachePath)),
    )).some(Boolean);
    return {
      hasKvCache: hasHealthyCache,
      needsRebuild: !hasHealthyCache,
      hasIncrementalBase: false,
      ...(hasHealthyCache
        ? {}
        : { issue: rawCachePaths.length > 0 ? 'cache-invalid' as const : 'missing' as const }),
    };
  }

  if (!index.entries) {
    return {
      hasKvCache: false,
      needsRebuild: true,
      hasIncrementalBase: false,
      issue: 'index-invalid',
    };
  }

  const activeEntries = index.entries.filter((entry) => entry.hint !== 'release');
  if (activeEntries.length === 0) {
    return {
      hasKvCache: false,
      needsRebuild: true,
      hasIncrementalBase: false,
      issue: 'index-entry-missing',
    };
  }

  const indexedCachePaths = activeEntries.map((entry) => resolveIndexedCachePath(storeDir, entry));
  const entriesAreHealthy = await Promise.all(indexedCachePaths.map(async (cachePath) => {
    return cachePath !== undefined && await hasHealthyCacheFile(cachePath);
  }));
  if (!entriesAreHealthy.every(Boolean)) {
    return {
      hasKvCache: false,
      needsRebuild: true,
      hasIncrementalBase: false,
      issue: 'index-entry-missing',
    };
  }

  // VLM exact snapshots are valid exact-cache hits, but the VLM controllers
  // intentionally do not search them as incremental bases.  `add` must
  // therefore take the full-rebuild path even when the snapshot is healthy.
  const hasVlmNamespace = activeEntries.some((entry, index) => {
    const indexedPath = indexedCachePaths[index];
    return entry.backend === 'vlm'
      || (indexedPath !== undefined && isVlmCachePath(indexedPath));
  });

  return {
    hasKvCache: true,
    needsRebuild: false,
    hasIncrementalBase: !hasVlmNamespace,
  };
}

/** Warning emitted after an automatic full cache rebuild. */
export function formatKvCacheRebuildWarning(storename: string, materialCount: number): string {
  return `warning: KV cache missing for store '${storename}'; `
    + `rebuilt cache from manifest (${materialCount} materials).`;
}
