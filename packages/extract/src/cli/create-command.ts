import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createExtractSession } from '../create-extract-session.js';
import { createMlxExtractRuntime } from '../create-mlx-extract-runtime.js';
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
      + `Run \`modular-extract clean ${options.storename}\` before creating it again.`,
    );
  }

  await mkdir(storeDir, { recursive: true });

  let runtime: Awaited<ReturnType<typeof createMlxExtractRuntime>> | undefined;
  let storeReady = false;
  try {
    runtime = await createMlxExtractRuntime({ model: options.model, cacheDir: storeDir });
    const session = createExtractSession({
      driver: runtime.driver,
      cacheController: runtime.cacheController,
      model: runtime.model,
      corpus: { materials },
    });

    await session.extract({
      cue: CACHE_PREPARE_CUE,
      options: { maxTokens: 1, temperature: 0 },
    });
    await session.close({ releaseCache: false });

    await writeManifest(storeDir, {
      version: 1,
      storename: options.storename,
      model: runtime.model,
      materials,
      createdAt: new Date().toISOString(),
    });
    storeReady = true;
  } finally {
    try {
      await runtime?.close();
    } finally {
      if (!storeReady) {
        await rm(storeDir, { recursive: true, force: true });
      }
    }
  }

  console.error(`Cache prepared: ${storeDir}`);
  console.error(`Materials: ${materials.length} file(s), model: ${runtime?.model}`);
}
