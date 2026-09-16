import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { MlxBackendMode } from '@modular-prompt/driver';
import type { MaterialInput } from '../extract-elements.js';
import type { ExtractProvider } from '../extract-runtime-types.js';
import { MANIFEST_FILENAME } from './constants.js';

export interface ExtractCacheManifest {
  version: 1;
  /** Store name for self-describing cache directories. */
  storename?: string;
  model: string;
  /** Provider that owns the persisted cache format. Missing means legacy MLX. */
  provider?: ExtractProvider;
  /** MLX backend selected when the store was prepared. Missing means `auto` for legacy stores. */
  backend?: MlxBackendMode;
  /** VLM image resize limit used to prepare the persisted cache. */
  maxImageSize?: number;
  materials: MaterialInput[];
  createdAt: string;
  updatedAt?: string;
}

function isMlxBackend(value: unknown): value is MlxBackendMode {
  return value === 'auto' || value === 'lm' || value === 'vlm' || value === 'optiq';
}

export function isExtractProvider(value: unknown): value is ExtractProvider {
  return value === 'mlx' || value === 'pytorch';
}

/** Resolve the provider of a manifest, preserving compatibility with MLX stores created before v1 provider metadata. */
export function getManifestProvider(manifest: ExtractCacheManifest): ExtractProvider {
  return manifest.provider ?? 'mlx';
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
    || (parsed.provider !== undefined && !isExtractProvider(parsed.provider))
    || (parsed.backend !== undefined && !isMlxBackend(parsed.backend))
    || (parsed.maxImageSize !== undefined
      && (typeof parsed.maxImageSize !== 'number'
        || !Number.isFinite(parsed.maxImageSize)
        || parsed.maxImageSize <= 0))
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
