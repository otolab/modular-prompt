import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMaterialsFromFiles } from './cli/load-materials.js';
import { runCreateCommand } from './cli/create-command.js';
import {
  manifestExists,
  readManifest,
  writeManifest,
  manifestPath,
} from './cli/manifest.js';
import { MANIFEST_FILENAME } from './cli/constants.js';

describe('cli/load-materials', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-cli-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads files as materials with basename title', async () => {
    const filePath = join(tempDir, 'notes.txt');
    await writeFile(filePath, 'Alice met Bob.', 'utf-8');

    const materials = await loadMaterialsFromFiles([filePath]);
    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      title: 'notes.txt',
      content: 'Alice met Bob.',
    });
    expect(materials[0]?.id).toContain('notes.txt');
  });

  it('requires at least one file', async () => {
    await expect(loadMaterialsFromFiles([])).rejects.toThrow(/At least one input file/);
  });
});

describe('cli/create dry-run', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-cli-create-dry-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prints compiled prompt without touching cache directory', async () => {
    const filePath = join(tempDir, 'notes.txt');
    await writeFile(filePath, 'Alice met Bob.', 'utf-8');

    const prompt = await runCreateCommand({
      cacheDir: join(tempDir, 'cache'),
      model: 'test-model',
      files: [filePath],
      dryRun: true,
    });

    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('Alice met Bob');
    expect(prompt).toContain('以下の Prepared Materials');
    expect(await manifestExists(join(tempDir, 'cache'))).toBe(false);
  });
});

describe('cli/manifest', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-cli-manifest-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes and reads manifest v1', async () => {
    const manifest = {
      version: 1 as const,
      model: 'test-model',
      materials: [{ title: 'doc', content: 'body' }],
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    await writeManifest(tempDir, manifest);
    expect(await manifestExists(tempDir)).toBe(true);
    expect(await readManifest(tempDir)).toEqual(manifest);

    const raw = await readFile(join(tempDir, MANIFEST_FILENAME), 'utf-8');
    expect(raw).toContain('"version": 1');
  });

  it('rejects invalid manifest', async () => {
    await writeFile(manifestPath(tempDir), '{"version":2}', 'utf-8');
    await expect(readManifest(tempDir)).rejects.toThrow(/Invalid manifest/);
  });
});
