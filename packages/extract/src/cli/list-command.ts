import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isKvCacheFile } from './store.js';
import { manifestExists, readManifest } from './manifest.js';

export interface ListCommandOptions {
  /** Container directory containing one subdirectory per store. */
  cacheDir: string;
}

export interface StoreSummary {
  storename: string;
  model: string;
  materialTitles: string[];
  createdAt: string;
  updatedAt?: string;
  hasKvCache: boolean;
}

async function listStoreDirectories(containerDir: string): Promise<string[]> {
  try {
    const entries = await readdir(containerDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function hasKvCache(storeDir: string): Promise<boolean> {
  const entries = await readdir(storeDir, { withFileTypes: true });
  return entries.some((entry) => entry.isFile() && isKvCacheFile(entry.name));
}

export async function listStores(cacheDir: string): Promise<StoreSummary[]> {
  const containerDir = resolve(cacheDir);
  const storeNames = await listStoreDirectories(containerDir);
  const summaries: StoreSummary[] = [];

  for (const storename of storeNames) {
    const storeDir = resolve(containerDir, storename);
    if (!(await manifestExists(storeDir))) {
      continue;
    }

    const manifest = await readManifest(storeDir);
    summaries.push({
      storename: manifest.storename ?? storename,
      model: manifest.model,
      materialTitles: manifest.materials.map((material) => material.title),
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      hasKvCache: await hasKvCache(storeDir),
    });
  }

  return summaries;
}

function formatSummary(summary: StoreSummary): string {
  const materials = summary.materialTitles.length > 0
    ? ` (${summary.materialTitles.join(', ')})`
    : '';
  const lines = [
    `Store: ${summary.storename}`,
    `  Model: ${summary.model}`,
    `  Materials: ${summary.materialTitles.length}${materials}`,
    `  Created: ${summary.createdAt}`,
  ];
  if (summary.updatedAt) {
    lines.push(`  Updated: ${summary.updatedAt}`);
  }
  lines.push(`  KV cache: ${summary.hasKvCache ? 'present' : 'missing'}`);
  return lines.join('\n');
}

export async function runListCommand(options: ListCommandOptions): Promise<string> {
  const containerDir = resolve(options.cacheDir);
  const summaries = await listStores(containerDir);
  if (summaries.length === 0) {
    return `No stores found in: ${containerDir}`;
  }
  return summaries.map(formatSummary).join('\n\n');
}
