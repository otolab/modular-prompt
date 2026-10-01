import { resolve } from 'node:path';
import { createExtractSession } from '../create-extract-session.js';
import { createExtractRuntime } from '../create-extract-runtime.js';
import {
  assertExtractRuntimeMatchesManifest,
  ensureStoreKvCache,
} from '../extract-store.js';
import { DEFAULT_MAX_TOKENS, resolveAutoRebuildCache } from './constants.js';
import { getManifestProvider, readManifest } from './manifest.js';
import { renderExtractPrompt } from './render-prompt.js';
import { formatKvCacheRebuildWarning, resolveStoreDir } from './store.js';

export interface ExtractCommandOptions {
  /** Container directory containing one subdirectory per store. */
  cacheDir: string;
  storename: string;
  query: string;
  maxTokens?: number;
  dryRun?: boolean;
  /** Automatically rebuild a missing/inconsistent store cache. Defaults to true. */
  autoRebuildCache?: boolean;
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

  const autoRebuildCache = resolveAutoRebuildCache(options.autoRebuildCache);
  const cacheResult = await ensureStoreKvCache({
    storeDir,
    storename: options.storename,
    manifest,
    autoRebuildCache,
  });
  if (cacheResult.rebuilt) {
    console.error(formatKvCacheRebuildWarning(options.storename, manifest.materials.length));
  }

  const runtime = await createExtractRuntime({
    model: manifest.model,
    provider: getManifestProvider(manifest),
    cacheDir: storeDir,
    ...(manifest.backend ? { backend: manifest.backend } : {}),
    ...(manifest.maxImageSize !== undefined ? { maxImageSize: manifest.maxImageSize } : {}),
  });

  try {
    assertExtractRuntimeMatchesManifest(runtime, manifest);
    const session = createExtractSession({
      driver: runtime.driver,
      cacheController: runtime.cacheController,
      model: runtime.model,
      maxImageSize: runtime.maxImageSize,
      corpus: { materials: manifest.materials },
      autoRebuildCache,
    });

    const result = await session.extract(request);
    await session.close({ releaseCache: false });
    return result.text;
  } finally {
    await runtime.close();
  }
}
