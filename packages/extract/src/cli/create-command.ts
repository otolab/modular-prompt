import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createExtractSession } from '../create-extract-session.js';
import { createMlxExtractRuntime } from '../create-mlx-extract-runtime.js';
import { CACHE_PREPARE_CUE } from './constants.js';
import { loadMaterialsFromFiles } from './load-materials.js';
import { manifestExists, writeManifest } from './manifest.js';
import { renderExtractPrompt } from './render-prompt.js';

export interface CreateCommandOptions {
  cacheDir: string;
  model?: string;
  files: string[];
  dryRun?: boolean;
}

export async function runCreateCommand(options: CreateCommandOptions): Promise<string | void> {
  const cacheDir = resolve(options.cacheDir);
  const materials = await loadMaterialsFromFiles(options.files);
  const request = { cue: CACHE_PREPARE_CUE };

  if (options.dryRun) {
    return renderExtractPrompt({ materials }, request);
  }

  if (await manifestExists(cacheDir)) {
    throw new Error(
      `Cache directory already exists: ${cacheDir}\n`
      + 'Remove the directory to clean the cache, then run create again.',
    );
  }

  await mkdir(cacheDir, { recursive: true });

  const runtime = await createMlxExtractRuntime({ model: options.model, cacheDir });
  try {
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

    await writeManifest(cacheDir, {
      version: 1,
      model: runtime.model,
      materials,
      createdAt: new Date().toISOString(),
    });
  } finally {
    await runtime.close();
  }

  console.error(`Cache prepared: ${cacheDir}`);
  console.error(`Materials: ${materials.length} file(s), model: ${runtime.model}`);
}
