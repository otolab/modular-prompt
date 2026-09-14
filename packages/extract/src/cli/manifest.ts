import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { MlxBackendMode } from '@modular-prompt/driver';
import type { MaterialInput } from '../extract-elements.js';
import { MANIFEST_FILENAME } from './constants.js';

export interface ExtractCacheManifest {
  version: 1;
  /** Store name for self-describing cache directories. */
  storename?: string;
  model: string;
  /** MLX backend selected when the store was prepared. Missing means `auto` for legacy stores. */
  backend?: MlxBackendMode;
  materials: MaterialInput[];
  createdAt: string;
  updatedAt?: string;
}

function isMlxBackend(value: unknown): value is MlxBackendMode {
  return value === 'auto' || value === 'lm' || value === 'vlm' || value === 'optiq';
}

export function manifestPath(cacheDir: string): string {
  return join(cacheDir, MANIFEST_FILENAME);
}

export async function manifestExists(cacheDir: string): Promise<boolean> {
  try {
    await access(manifestPath(cacheDir));
    return true;
  } catch {
    return false;
  }
}

export async function readManifest(cacheDir: string): Promise<ExtractCacheManifest> {
  const raw = await readFile(manifestPath(cacheDir), 'utf-8');
  const parsed = JSON.parse(raw) as ExtractCacheManifest;
  if (
    parsed.version !== 1
    || !parsed.model
    || !Array.isArray(parsed.materials)
    || (parsed.backend !== undefined && !isMlxBackend(parsed.backend))
    || (parsed.updatedAt !== undefined && typeof parsed.updatedAt !== 'string')
  ) {
    throw new Error(`Invalid manifest: ${manifestPath(cacheDir)}`);
  }
  return parsed;
}

export async function writeManifest(
  cacheDir: string,
  manifest: ExtractCacheManifest,
): Promise<void> {
  await writeFile(
    manifestPath(cacheDir),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8',
  );
}
