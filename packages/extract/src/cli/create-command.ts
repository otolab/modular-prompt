import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareExtractCache } from '../extract-store.js';
import type { ExtractProvider } from '../extract-runtime-types.js';
import { CACHE_PREPARE_CUE } from './constants.js';
import { loadMaterialsFromFiles } from './load-materials.js';
import { writeManifest } from './manifest.js';
import { renderExtractPrompt } from './render-prompt.js';
import { resolveStoreDir, storeExists } from './store.js';

export interface CreateCommandOptions {
  /** Container directory containing one subdirectory per store. */
  cacheDir: string;
  storename: string;
  model?: string;
  provider?: ExtractProvider;
  files: string[];
  dryRun?: boolean;
}

export async function runCreateCommand(options: CreateCommandOptions): Promise<string | void> {
  const containerDir = resolve(options.cacheDir);
  const storeDir = resolveStoreDir(containerDir, options.storename);
  const materials = await loadMaterialsFromFiles(options.files);
  const request = { cue: CACHE_PREPARE_CUE };

  if (options.dryRun) {
    return renderExtractPrompt({ materials }, request);
  }

  if (await storeExists(storeDir)) {
    throw new Error(
      `Store already exists: ${storeDir}\n`
      + `Run \`modular-prompt-extract clean ${options.storename}\` before creating it again.`,
    );
  }

  await mkdir(storeDir, { recursive: true });

  let storeReady = false;
  let prepared: Awaited<ReturnType<typeof prepareExtractCache>> | undefined;
  try {
    prepared = await prepareExtractCache({
      cacheDir: storeDir,
      model: options.model,
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      materials,
    });
    const createdAt = new Date().toISOString();

    await writeManifest(storeDir, {
      version: 1,
      storename: options.storename,
      model: prepared.model,
      provider: prepared.provider,
      backend: prepared.backend,
      ...(prepared.maxImageSize !== undefined
        ? { maxImageSize: prepared.maxImageSize }
        : {}),
      materials,
      createdAt,
      updatedAt: createdAt,
    });
    storeReady = true;
  } finally {
    if (!storeReady) {
      await rm(storeDir, { recursive: true, force: true });
    }
  }

  console.error(`Cache prepared: ${storeDir}`);
  console.error(
    `Materials: ${materials.length} file(s), model: ${prepared.model}, provider: ${prepared.provider}`
      + (prepared.backend !== undefined ? `, backend: ${prepared.backend}` : ''),
  );
}
