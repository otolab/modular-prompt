import { resolve } from 'node:path';
import {
  appendToExtractStore,
  mergeMaterials,
  readExtractStoreManifest,
} from '../extract-store.js';
import { CACHE_PREPARE_CUE } from './constants.js';
import { loadMaterialsFromFiles } from './load-materials.js';
import { renderExtractPrompt } from './render-prompt.js';
import { resolveStoreDir } from './store.js';

export interface AddCommandOptions {
  /** Container directory containing one subdirectory per store. */
  cacheDir: string;
  storename: string;
  files: string[];
  dryRun?: boolean;
}

export async function runAddCommand(options: AddCommandOptions): Promise<string | void> {
  const containerDir = resolve(options.cacheDir);
  const storeDir = resolveStoreDir(containerDir, options.storename);
  const manifest = await readExtractStoreManifest(storeDir, options.storename);
  const incomingMaterials = await loadMaterialsFromFiles(options.files);
  const materials = mergeMaterials(manifest.materials, incomingMaterials);
  const request = { cue: CACHE_PREPARE_CUE };

  if (options.dryRun) {
    return renderExtractPrompt({ materials }, request);
  }

  const result = await appendToExtractStore({
    storeDir,
    storename: options.storename,
    incomingMaterials,
    existingManifest: manifest,
  });

  console.error(`Cache extended: ${storeDir}`);
  console.error(`Materials: ${result.manifest.materials.length} file(s), model: ${result.model}`);
}

// Keep the merge operation discoverable next to the CLI entry point while the
// implementation remains in the reusable extract-store layer.
export { mergeMaterials };
