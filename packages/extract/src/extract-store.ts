import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createExtractSession } from './create-extract-session.js';
import { createMlxExtractRuntime } from './create-mlx-extract-runtime.js';
import type { MaterialInput } from './extract-elements.js';
import { CACHE_PREPARE_CUE } from './cli/constants.js';
import {
  manifestExists,
  readManifest,
  writeManifest,
  type ExtractCacheManifest,
} from './cli/manifest.js';
import { storeExists } from './cli/store.js';

export interface PrepareExtractCacheOptions {
  /** Directory containing the persistent cache files. */
  cacheDir: string;
  /** MLX model alias or resolved model ID. */
  model?: string;
  /** Corpus to prefill into the cache. */
  materials: readonly MaterialInput[];
}

async function closeRuntimePreservingError(
  runtime: Awaited<ReturnType<typeof createMlxExtractRuntime>>,
  operationError: unknown,
): Promise<void> {
  try {
    await runtime.close();
  } catch (closeError: unknown) {
    if (operationError === undefined) {
      throw closeError;
    }
  }
}

/**
 * Prepare the persistent corpus cache and release all runtime resources.
 *
 * The caller owns the manifest transaction. This operation only creates or
 * extends the cache in `cacheDir` and returns the model ID resolved by MLX.
 */
export async function prepareExtractCache(
  options: PrepareExtractCacheOptions,
): Promise<string> {
  const runtime = await createMlxExtractRuntime({
    model: options.model,
    cacheDir: options.cacheDir,
  });
  let operationError: unknown;

  try {
    const session = createExtractSession({
      driver: runtime.driver,
      cacheController: runtime.cacheController,
      model: runtime.model,
      corpus: { materials: options.materials },
      cachePreparation: 'required',
    });

    await session.extract({
      cue: CACHE_PREPARE_CUE,
      options: { maxTokens: 1, temperature: 0 },
    });
    await session.close({ releaseCache: false });
    return runtime.model;
  } catch (error: unknown) {
    operationError = error;
    throw error;
  } finally {
    // Keep the prefill/session error as the primary failure. A close error
    // is still surfaced when the operation itself succeeded.
    await closeRuntimePreservingError(runtime, operationError);
  }
}

function materialKey(material: MaterialInput): string {
  return material.id ?? material.title;
}

function hasSameContent(left: MaterialInput, right: MaterialInput): boolean {
  return left.title === right.title
    && left.usage === right.usage
    && isDeepStrictEqual(left.content, right.content);
}

/**
 * Merge newly loaded materials into an existing corpus.
 *
 * File-based materials use their absolute path as `id`. Re-adding the same
 * content is idempotent; changing the content behind an existing id is
 * rejected because the persisted KV cache can no longer be trusted.
 */
export function mergeMaterials(
  existing: readonly MaterialInput[],
  incoming: readonly MaterialInput[],
): MaterialInput[] {
  const merged = [...existing];
  const indexById = new Map<string, number>();

  for (const [index, material] of existing.entries()) {
    if (!indexById.has(materialKey(material))) {
      indexById.set(materialKey(material), index);
    }
  }

  for (const material of incoming) {
    const id = materialKey(material);
    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      indexById.set(id, merged.length);
      merged.push(material);
      continue;
    }

    const previous = merged[existingIndex];
    if (previous && !hasSameContent(previous, material)) {
      throw new Error(
        `Material content differs for duplicate id '${id}'. `
        + 'Run `modular-prompt-extract clean <storename>` and create the store again.',
      );
    }
  }

  return merged;
}

function missingStoreError(storeDir: string, storename: string): Error {
  return new Error(
    `Store not found: ${storeDir}\n`
    + `Run \`modular-prompt-extract create ${storename} <files...>\` first.`,
  );
}

/** Read and validate a named store manifest with a user-facing missing-store error. */
export async function readExtractStoreManifest(
  storeDir: string,
  storename: string,
): Promise<ExtractCacheManifest> {
  const resolvedStoreDir = resolve(storeDir);
  if (!(await storeExists(resolvedStoreDir))) {
    throw missingStoreError(resolvedStoreDir, storename);
  }
  if (!(await manifestExists(resolvedStoreDir))) {
    throw new Error(`Store manifest not found: ${resolvedStoreDir}`);
  }
  return readManifest(resolvedStoreDir);
}

export interface AppendToExtractStoreOptions {
  /** Existing named store directory. */
  storeDir: string;
  /** Store name used in actionable error messages. */
  storename: string;
  /** Materials loaded from the files supplied to `add`. */
  incomingMaterials: readonly MaterialInput[];
  /** Manifest read by the CLI before loading files, when available. */
  existingManifest?: ExtractCacheManifest;
  /** Injectable clock for deterministic callers and tests. */
  now?: () => string;
}

export interface AppendToExtractStoreResult {
  manifest: ExtractCacheManifest;
  model: string;
  addedMaterials: number;
}

async function replaceStoreWithStaging(
  storeDir: string,
  stagingDir: string,
): Promise<void> {
  const backupDir = join(
    dirname(storeDir),
    `.${basename(storeDir)}.backup-${randomUUID()}`,
  );

  await rename(storeDir, backupDir);
  try {
    await rename(stagingDir, storeDir);
  } catch (error: unknown) {
    try {
      await rename(backupDir, storeDir);
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [error, rollbackError],
        `Failed to replace store and roll back ${storeDir}`,
      );
    }
    throw error;
  }

  // The new store is already committed. A failure to remove the old snapshot
  // must not turn a successful add into a reported failure.
  await rm(backupDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Append materials to a persistent extract store transactionally.
 *
 * Prefill happens in a copied staging directory. The original store is only
 * swapped after the new cache and manifest are both ready, so failures leave
 * the old corpus/KV pair intact.
 */
export async function appendToExtractStore(
  options: AppendToExtractStoreOptions,
): Promise<AppendToExtractStoreResult> {
  const storeDir = resolve(options.storeDir);
  if (!(await storeExists(storeDir))) {
    throw missingStoreError(storeDir, options.storename);
  }

  const previousManifest = options.existingManifest
    ?? await readExtractStoreManifest(storeDir, options.storename);
  const materials = mergeMaterials(previousManifest.materials, options.incomingMaterials);
  const stagingDir = await mkdtemp(join(dirname(storeDir), `.${basename(storeDir)}.add-`));
  let committed = false;

  try {
    await cp(storeDir, stagingDir, { recursive: true, force: true });

    const model = await prepareExtractCache({
      cacheDir: stagingDir,
      model: previousManifest.model,
      materials,
    });
    const nextManifest: ExtractCacheManifest = {
      ...previousManifest,
      materials,
      updatedAt: (options.now ?? (() => new Date().toISOString()))(),
    };
    await writeManifest(stagingDir, nextManifest);

    await replaceStoreWithStaging(storeDir, stagingDir);
    committed = true;
    return {
      manifest: nextManifest,
      model,
      addedMaterials: materials.length - previousManifest.materials.length,
    };
  } finally {
    if (!committed) {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }
}
