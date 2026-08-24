import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { MaterialInput } from '../extract-elements.js';
import { MANIFEST_FILENAME } from './constants.js';

export interface ExtractCacheManifest {
  version: 1;
  model: string;
  materials: MaterialInput[];
  createdAt: string;
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
  if (parsed.version !== 1 || !parsed.model || !Array.isArray(parsed.materials)) {
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
