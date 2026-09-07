import { stat } from 'node:fs/promises';
import { join } from 'node:path';

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

/** Return whether the store contains at least one persisted KV cache archive. */
export function isKvCacheFile(filename: string): boolean {
  return filename.endsWith('.safetensors.zip');
}
