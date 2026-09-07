import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCreateCommand } from './create-command.js';
import { runExtractCommand } from './extract-command.js';
import { readManifest } from './manifest.js';
import { storeExists } from './store.js';
import type * as ManifestModule from './manifest.js';

const { createRuntimeMock, createSessionMock, writeManifestMock } = vi.hoisted(() => ({
  createRuntimeMock: vi.fn(),
  createSessionMock: vi.fn(),
  writeManifestMock: vi.fn(),
}));

vi.mock('../create-mlx-extract-runtime.js', () => ({
  createMlxExtractRuntime: createRuntimeMock,
}));

vi.mock('../create-extract-session.js', () => ({
  createExtractSession: createSessionMock,
}));

vi.mock('./manifest.js', async () => {
  const actual = await vi.importActual<typeof ManifestModule>('./manifest.js');
  writeManifestMock.mockImplementation(
    (...args: Parameters<typeof actual.writeManifest>) => actual.writeManifest(...args),
  );
  return { ...actual, writeManifest: writeManifestMock };
});

describe('cli store commands', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'extract-cli-commands-'));
    createRuntimeMock.mockReset();
    createSessionMock.mockReset();
    writeManifestMock.mockClear();
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

  it('allows retry after runtime creation fails', async () => {
    const filePath = join(tempDir, 'runtime-failure.txt');
    const storename = 'runtime-failure';
    await writeFile(filePath, 'runtime failure', 'utf-8');
    const runtimeError = new Error('runtime creation failed');
    createRuntimeMock.mockRejectedValueOnce(runtimeError);

    await expect(runCreateCommand({
      cacheDir: tempDir,
      storename,
      files: [filePath],
    })).rejects.toBe(runtimeError);

    expect(await storeExists(join(tempDir, storename))).toBe(false);
    await expect(runCreateCommand({
      cacheDir: tempDir,
      storename,
      files: [filePath],
    })).resolves.toBeUndefined();
    expect(await storeExists(join(tempDir, storename))).toBe(true);
  });

  it('allows retry after session extraction fails', async () => {
    const filePath = join(tempDir, 'session-failure.txt');
    const storename = 'session-failure';
    await writeFile(filePath, 'session failure', 'utf-8');
    const sessionError = new Error('session extraction failed');
    createSessionMock.mockImplementationOnce(() => ({
      extract: vi.fn().mockRejectedValue(sessionError),
      close: vi.fn().mockResolvedValue(undefined),
    }));

    await expect(runCreateCommand({
      cacheDir: tempDir,
      storename,
      files: [filePath],
    })).rejects.toBe(sessionError);

    expect(await storeExists(join(tempDir, storename))).toBe(false);
    await expect(runCreateCommand({
      cacheDir: tempDir,
      storename,
      files: [filePath],
    })).resolves.toBeUndefined();
    expect(await storeExists(join(tempDir, storename))).toBe(true);
  });

  it('allows retry after manifest writing fails', async () => {
    const filePath = join(tempDir, 'manifest-failure.txt');
    const storename = 'manifest-failure';
    await writeFile(filePath, 'manifest failure', 'utf-8');
    const manifestError = new Error('manifest writing failed');
    writeManifestMock.mockRejectedValueOnce(manifestError);

    await expect(runCreateCommand({
      cacheDir: tempDir,
      storename,
      files: [filePath],
    })).rejects.toBe(manifestError);

    expect(await storeExists(join(tempDir, storename))).toBe(false);
    await expect(runCreateCommand({
      cacheDir: tempDir,
      storename,
      files: [filePath],
    })).resolves.toBeUndefined();
    expect(await storeExists(join(tempDir, storename))).toBe(true);
  });
});
