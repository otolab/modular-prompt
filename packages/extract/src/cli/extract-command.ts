import { resolve } from 'node:path';
import { createExtractSession } from '../create-extract-session.js';
import { createMlxExtractRuntime } from '../create-mlx-extract-runtime.js';
import { DEFAULT_MAX_TOKENS } from './constants.js';
import { readManifest } from './manifest.js';
import { renderExtractPrompt } from './render-prompt.js';

export interface ExtractCommandOptions {
  cacheDir: string;
  query: string;
  maxTokens?: number;
  dryRun?: boolean;
}

export async function runExtractCommand(options: ExtractCommandOptions): Promise<string> {
  const cacheDir = resolve(options.cacheDir);
  const manifest = await readManifest(cacheDir);

  if (!options.query.trim()) {
    throw new Error('Query text is required');
  }

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
    cacheDir,
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
