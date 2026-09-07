import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCreateCommand } from './create-command.js';
import { runAddCommand } from './add-command.js';
import { runCleanCommand } from './clean-command.js';
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

  it('adds materials to an existing store and prepares the merged corpus', async () => {
    const firstFile = join(tempDir, 'day1.txt');
    const secondFile = join(tempDir, 'day2.txt');
    await writeFile(firstFile, 'Alice met Bob on day one.', 'utf-8');
    await writeFile(secondFile, 'They agreed on day two.', 'utf-8');

    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      model: 'meeting-model',
      files: [firstFile],
    });
    createRuntimeMock.mockClear();
    createSessionMock.mockClear();

    await runAddCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [secondFile],
    });

    const manifest = await readManifest(join(tempDir, 'meeting'));
    expect(manifest.materials).toEqual([
      expect.objectContaining({ id: firstFile, content: 'Alice met Bob on day one.' }),
      expect.objectContaining({ id: secondFile, content: 'They agreed on day two.' }),
    ]);
    expect(manifest.updatedAt).toEqual(expect.any(String));
    expect(createRuntimeMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'meeting-model',
      cacheDir: expect.stringContaining('.meeting.add-'),
    }));
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'meeting-model',
      corpus: { materials: manifest.materials },
    }));

    createRuntimeMock.mockClear();
    createSessionMock.mockClear();
    await expect(runExtractCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      query: 'Summarize both days',
    })).resolves.toBe('mock extraction');
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      corpus: { materials: manifest.materials },
    }));
  });

  it('renders the merged corpus without running MLX in add dry-run mode', async () => {
    const firstFile = join(tempDir, 'first.txt');
    const secondFile = join(tempDir, 'second.txt');
    await writeFile(firstFile, 'first material', 'utf-8');
    await writeFile(secondFile, 'second material', 'utf-8');

    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [firstFile],
    });
    createRuntimeMock.mockClear();

    const prompt = await runAddCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [secondFile],
      dryRun: true,
    });

    expect(prompt).toContain('first material');
    expect(prompt).toContain('second material');
    expect(createRuntimeMock).not.toHaveBeenCalled();
    expect((await readManifest(join(tempDir, 'meeting'))).materials).toHaveLength(1);
  });

  it('skips re-adding identical material and rejects changed duplicate content', async () => {
    const filePath = join(tempDir, 'notes.txt');
    await writeFile(filePath, 'original notes', 'utf-8');

    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [filePath],
    });
    createRuntimeMock.mockClear();

    await runAddCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [filePath],
    });
    expect((await readManifest(join(tempDir, 'meeting'))).materials).toHaveLength(1);

    await writeFile(filePath, 'changed notes', 'utf-8');
    createRuntimeMock.mockClear();
    await expect(runAddCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [filePath],
    })).rejects.toThrow(/clean.*create/);
    expect(createRuntimeMock).not.toHaveBeenCalled();
    expect((await readManifest(join(tempDir, 'meeting'))).materials[0]?.content)
      .toBe('original notes');
  });

  it('keeps the existing store when add preparation fails', async () => {
    const firstFile = join(tempDir, 'first.txt');
    const secondFile = join(tempDir, 'second.txt');
    await writeFile(firstFile, 'first material', 'utf-8');
    await writeFile(secondFile, 'second material', 'utf-8');

    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [firstFile],
    });
    const originalManifest = await readFile(join(tempDir, 'meeting', 'manifest.json'), 'utf-8');
    const preparationError = new Error('incremental prefill failed');
    createSessionMock.mockImplementationOnce(() => ({
      extract: vi.fn().mockRejectedValue(preparationError),
      close: vi.fn().mockResolvedValue(undefined),
    }));

    await expect(runAddCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [secondFile],
    })).rejects.toBe(preparationError);

    expect(await readFile(join(tempDir, 'meeting', 'manifest.json'), 'utf-8'))
      .toBe(originalManifest);
    expect((await readManifest(join(tempDir, 'meeting'))).materials).toHaveLength(1);
  });

  it('keeps the existing store when add manifest writing fails', async () => {
    const firstFile = join(tempDir, 'first.txt');
    const secondFile = join(tempDir, 'second.txt');
    await writeFile(firstFile, 'first material', 'utf-8');
    await writeFile(secondFile, 'second material', 'utf-8');

    await runCreateCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [firstFile],
    });
    const originalManifest = await readFile(join(tempDir, 'meeting', 'manifest.json'), 'utf-8');
    const manifestError = new Error('incremental manifest write failed');
    writeManifestMock.mockRejectedValueOnce(manifestError);

    await expect(runAddCommand({
      cacheDir: tempDir,
      storename: 'meeting',
      files: [secondFile],
    })).rejects.toBe(manifestError);

    expect(await readFile(join(tempDir, 'meeting', 'manifest.json'), 'utf-8'))
      .toBe(originalManifest);
    expect((await readManifest(join(tempDir, 'meeting'))).materials).toHaveLength(1);
  });

  it('reports a clear error when adding to a missing store', async () => {
    const filePath = join(tempDir, 'notes.txt');
    await writeFile(filePath, 'notes', 'utf-8');

    await expect(runAddCommand({
      cacheDir: tempDir,
      storename: 'missing',
      files: [filePath],
    })).rejects.toThrow(/Store not found.*create missing/s);
  });

  it('allows creating a store again after cleaning the whole container', async () => {
    const inputDir = await mkdtemp(join(tmpdir(), 'extract-cli-input-'));
    const filePath = join(inputDir, 'notes.txt');
    await writeFile(filePath, 'notes', 'utf-8');

    try {
      await runCreateCommand({
        cacheDir: tempDir,
        storename: 'meeting',
        files: [filePath],
      });
      await runCreateCommand({
        cacheDir: tempDir,
        storename: 'contract',
        files: [filePath],
      });

      await expect(runCleanCommand({ cacheDir: tempDir, all: true }))
        .resolves.toBe(`Removed cache container: ${tempDir}`);
      await expect(storeExists(tempDir)).resolves.toBe(false);

      await expect(runCreateCommand({
        cacheDir: tempDir,
        storename: 'meeting',
        files: [filePath],
      })).resolves.toBeUndefined();
      await expect(storeExists(join(tempDir, 'meeting'))).resolves.toBe(true);
    } finally {
      await rm(inputDir, { recursive: true, force: true });
    }
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
