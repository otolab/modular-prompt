import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runListCommand, listStores } from './list-command.js';
import { writeManifest } from './manifest.js';

describe('cli/list', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-cli-list-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('scans store directories and formats manifest and KV summaries', async () => {
    const meetingDir = join(tempDir, 'meeting');
    const contractDir = join(tempDir, 'contract');
    await mkdir(meetingDir, { recursive: true });
    await mkdir(contractDir, { recursive: true });
    await writeManifest(meetingDir, {
      version: 1,
      storename: 'meeting',
      model: 'mlx-community/MeetingModel-4bit',
      materials: [
        { title: 'notes.txt', content: 'meeting notes' },
        { title: 'agenda.txt', content: 'agenda' },
      ],
      createdAt: '2026-09-07T03:00:00.000Z',
    });
    await writeManifest(contractDir, {
      version: 1,
      model: 'mlx-community/ContractModel-4bit',
      materials: [{ title: 'contract.pdf', content: 'contract' }],
      createdAt: '2026-09-07T04:00:00.000Z',
    });
    await writeFile(join(meetingDir, 'cache-index.json'), '{}', 'utf-8');
    await writeFile(join(meetingDir, 'meeting-cache.safetensors.zip'), 'cache', 'utf-8');

    const output = await runListCommand({ cacheDir: tempDir });

    expect(output).toContain('Store: contract');
    expect(output).toContain('  Model: mlx-community/ContractModel-4bit');
    expect(output).toContain('  Materials: 1 (contract.pdf)');
    expect(output).toContain('  KV cache: missing');
    expect(output).toContain('Store: meeting');
    expect(output).toContain('  Materials: 2 (notes.txt, agenda.txt)');
    expect(output).toContain('  Created: 2026-09-07T03:00:00.000Z');
    expect(output).toContain('  KV cache: present');
    expect(output.indexOf('Store: contract')).toBeLessThan(output.indexOf('Store: meeting'));

    await expect(listStores(tempDir)).resolves.toHaveLength(2);
  });

  it('returns an empty-container summary when no stores exist', async () => {
    await expect(runListCommand({ cacheDir: join(tempDir, 'missing') }))
      .resolves.toContain('No stores found');
  });

  it('ignores directories without a manifest', async () => {
    await mkdir(join(tempDir, 'unfinished'), { recursive: true });

    await expect(listStores(tempDir)).resolves.toEqual([]);
  });
});
