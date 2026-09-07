import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCreateCommand } from './create-command.js';
import { runExtractCommand } from './extract-command.js';
import { readManifest } from './manifest.js';

const { createRuntimeMock, createSessionMock } = vi.hoisted(() => ({
  createRuntimeMock: vi.fn(),
  createSessionMock: vi.fn(),
}));

vi.mock('../create-mlx-extract-runtime.js', () => ({
  createMlxExtractRuntime: createRuntimeMock,
}));

vi.mock('../create-extract-session.js', () => ({
  createExtractSession: createSessionMock,
}));

describe('cli store commands', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-cli-commands-'));
    createRuntimeMock.mockReset();
    createSessionMock.mockReset();
    createRuntimeMock.mockImplementation(async ({ model }: { model?: string }) => ({
      driver: {},
      cacheController: {},
      model: model ?? 'resolved-default-model',
      close: vi.fn().mockResolvedValue(undefined),
    }));
    createSessionMock.mockReturnValue({
      extract: vi.fn().mockResolvedValue({ text: 'mock extraction', index: 0 }),
      close: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('keeps multiple creates and extracts isolated by storename', async () => {
    const meetingFile = join(tempDir, 'meeting.txt');
    const contractFile = join(tempDir, 'contract.txt');
    await writeFile(meetingFile, 'Alice met Bob.', 'utf-8');
    await writeFile(contractFile, 'The term is twelve months.', 'utf-8');

    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      model: 'meeting-model',
      files: [meetingFile],
    });
    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'contract',
      model: 'contract-model',
      files: [contractFile],
    });

    const meetingManifest = await readManifest(join(tempDir, 'meeting'));
    const contractManifest = await readManifest(join(tempDir, 'contract'));
    expect(meetingManifest).toMatchObject({
      storename: 'meeting',
      model: 'meeting-model',
      materials: [{ title: 'meeting.txt', content: 'Alice met Bob.' }],
    });
    expect(contractManifest).toMatchObject({
      storename: 'contract',
      model: 'contract-model',
      materials: [{ title: 'contract.txt', content: 'The term is twelve months.' }],
    });
    expect(JSON.parse(await readFile(join(tempDir, 'meeting', 'manifest.json'), 'utf-8')))
      .not.toEqual(expect.objectContaining({ materials: contractManifest.materials }));

    createRuntimeMock.mockClear();
    createSessionMock.mockClear();

    await expect(runExtractCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      query: 'List people',
    })).resolves.toBe('mock extraction');
    await expect(runExtractCommand({
      cacheDir: tempDir,
      storename: 'contract',
      query: 'Extract the term',
    })).resolves.toBe('mock extraction');

    expect(createRuntimeMock).toHaveBeenNthCalledWith(1, {
      model: 'meeting-model',
      cacheDir: join(tempDir, 'meeting'),
    });
    expect(createRuntimeMock).toHaveBeenNthCalledWith(2, {
      model: 'contract-model',
      cacheDir: join(tempDir, 'contract'),
    });
    expect(createSessionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      model: 'meeting-model',
      corpus: { materials: meetingManifest.materials },
    }));
    expect(createSessionMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      model: 'contract-model',
      corpus: { materials: contractManifest.materials },
    }));
  });

  it('rejects creating an existing store and points to clean', async () => {
    const filePath = join(tempDir, 'notes.txt');
    await writeFile(filePath, 'notes', 'utf-8');

    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [filePath],
    });

    await expect(runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [filePath],
    })).rejects.toThrow(/clean meeting/);
  });
});
