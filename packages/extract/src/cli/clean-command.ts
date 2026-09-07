import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveStoreDir, storeExists } from './store.js';

export interface CleanCommandOptions {
  /** Container directory containing one subdirectory per store. */
  cacheDir: string;
  /** Store name to remove; omitted when removing the whole container. */
  storename?: string;
  /** Remove the whole container instead of one store. */
  all?: boolean;
}

export async function runCleanCommand(options: CleanCommandOptions): Promise<string> {
  const containerDir = resolve(options.cacheDir);

  if (options.all) {
    if (options.storename !== undefined) {
      throw new Error('clean --all cannot be used with a storename');
    }
    const existed = await storeExists(containerDir);
    await rm(containerDir, { recursive: true, force: true });
    return existed
      ? `Removed cache container: ${containerDir}`
      : `No cache container found: ${containerDir}`;
  }

  if (!options.storename) {
    throw new Error('clean requires a storename or --all');
  }

  const storeDir = resolveStoreDir(containerDir, options.storename);
  const existed = await storeExists(storeDir);
  await rm(storeDir, { recursive: true, force: true });
  return existed
    ? `Removed store: ${storeDir}`
    : `No store found: ${storeDir}`;
}
