import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { MaterialInput } from '../extract-elements.js';

export async function loadMaterialsFromFiles(paths: string[]): Promise<MaterialInput[]> {
  if (paths.length === 0) {
    throw new Error('At least one input file is required');
  }

  const materials: MaterialInput[] = [];
  for (const inputPath of paths) {
    const absolutePath = resolve(inputPath);
    const content = await readFile(absolutePath, 'utf-8');
    const title = basename(absolutePath);
    materials.push({
      id: absolutePath,
      title,
      content,
    });
  }
  return materials;
}
