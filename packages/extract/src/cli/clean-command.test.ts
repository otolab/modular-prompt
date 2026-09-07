import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCleanCommand } from './clean-command.js';
import { storeExists } from './store.js';

describe('cli/clean', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-cli-clean-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('removes one store recursively and leaves other stores intact', async () => {
    const meetingDir = join(tempDir, 'meeting');
    const contractDir = join(tempDir, 'contract');
    await mkdir(join(meetingDir, 'nested'), { recursive: true });
    await mkdir(contractDir, { recursive: true });
    await writeFile(join(meetingDir, 'nested', 'cache.safetensors.zip'), 'meeting', 'utf-8');
    await writeFile(join(contractDir, 'manifest.json'), '{}', 'utf-8');

    await expect(runCleanCommand({ cacheDir: tempDir, storename: 'meeting' }))
      .resolves.toBe(`Removed store: ${meetingDir}`);

    await expect(storeExists(meetingDir)).resolves.toBe(false);
    await expect(storeExists(contractDir)).resolves.toBe(true);
  });

  it('removes the entire container with --all', async () => {
    await mkdir(join(tempDir, 'meeting'), { recursive: true });
    await writeFile(join(tempDir, 'container-file'), 'cache', 'utf-8');

    await expect(runCleanCommand({ cacheDir: tempDir, all: true }))
      .resolves.toBe(`Removed cache container: ${tempDir}`);

    await expect(storeExists(tempDir)).resolves.toBe(false);
  });

  it('reports a missing store without failing', async () => {
    const missingStoreDir = join(tempDir, 'missing');

    await expect(runCleanCommand({ cacheDir: tempDir, storename: 'missing' }))
      .resolves.toBe(`No store found: ${missingStoreDir}`);

    await expect(storeExists(tempDir)).resolves.toBe(true);
  });

  it('reports a missing container without failing', async () => {
    const missingContainerDir = join(tempDir, 'missing-container');

    await expect(runCleanCommand({ cacheDir: missingContainerDir, all: true }))
      .resolves.toBe(`No cache container found: ${missingContainerDir}`);

    await expect(storeExists(missingContainerDir)).resolves.toBe(false);
  });
});
