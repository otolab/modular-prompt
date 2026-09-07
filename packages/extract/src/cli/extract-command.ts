import { resolve } from 'node:path';
import { createExtractSession } from '../create-extract-session.js';
import { createMlxExtractRuntime } from '../create-mlx-extract-runtime.js';
import { DEFAULT_MAX_TOKENS } from './constants.js';
import { readManifest } from './manifest.js';
import { renderExtractPrompt } from './render-prompt.js';
import { resolveStoreDir } from './store.js';

export interface ExtractCommandOptions {
  /** Container directory containing one subdirectory per store. */
  cacheDir: string;
  storename: string;
  query: string;
  maxTokens?: number;
  dryRun?: boolean;
}

export async function runExtractCommand(options: ExtractCommandOptions): Promise<string> {
  const containerDir = resolve(options.cacheDir);
  const storeDir = resolveStoreDir(containerDir, options.storename);

  if (!options.query.trim()) {
    throw new Error('Query text is required');
  }

  const manifest = await readManifest(storeDir);

  const request = {
    cue: options.query,
    options: {
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: 0 as const,
    },
  };

  if (options.dryRun) {
    return renderExtractPrompt({ materials: manifest.materials }, request);
  }

  const runtime = await createMlxExtractRuntime({
    model: manifest.model,
    cacheDir: storeDir,
  });

  try {
    const session = createExtractSession({
      driver: runtime.driver,
      cacheController: runtime.cacheController,
      model: runtime.model,
      corpus: { materials: manifest.materials },
    });

    const result = await session.extract(request);
    await session.close({ releaseCache: false });
    return result.text;
  } finally {
    await runtime.close();
  }
}
