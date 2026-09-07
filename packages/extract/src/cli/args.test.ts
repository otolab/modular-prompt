import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

describe('cli argument parser', () => {
  it('takes the first positional argument after create as the storename', () => {
    expect(parseArgs([
      'create',
      'meeting',
      '-d',
      '.cache',
      '-m',
      'mlx-model',
      '--dry-run',
      'notes.txt',
      'agenda.txt',
    ])).toEqual({
      command: 'create',
      cacheDir: '.cache',
      model: 'mlx-model',
      dryRun: true,
      storename: 'meeting',
      positional: ['notes.txt', 'agenda.txt'],
    });
  });

  it('takes the first positional argument after extract as the storename', () => {
    expect(parseArgs([
      'extract',
      'contract',
      '--max-tokens',
      '120',
      'extract',
      'the',
      'term',
    ])).toEqual({
      command: 'extract',
      maxTokens: 120,
      storename: 'contract',
      positional: ['extract', 'the', 'term'],
    });
  });

  it('accepts the common cache container option for list', () => {
    expect(parseArgs(['list', '--cache-dir', '.extract-cache'])).toEqual({
      command: 'list',
      cacheDir: '.extract-cache',
      positional: [],
    });
  });

  it.each(['', 'bad/name', '_bad', 'bad name', 'create', 'extract', 'list', 'clean'])(
    'rejects invalid storename %j',
    (storename) => {
      expect(() => parseArgs(['create', storename, 'notes.txt'])).toThrow(/storename/);
    },
  );

  it.each(['create', 'extract'])('requires a storename for %s', (command) => {
    expect(() => parseArgs([command])).toThrow(/storename as its first argument/);
  });

  it('rejects options belonging to another subcommand', () => {
    expect(() => parseArgs(['create', 'meeting', '--max-tokens', '10', 'notes.txt']))
      .toThrow(/only valid with extract/);
    expect(() => parseArgs(['extract', 'meeting', '--model', 'model', 'query']))
      .toThrow(/only valid with create/);
  });
});
