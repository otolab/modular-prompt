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

  it('takes the first positional argument after add as the storename', () => {
    expect(parseArgs([
      'add',
      'meeting',
      '--dry-run',
      '-d',
      '.extract-cache',
      'day2.txt',
    ])).toEqual({
      command: 'add',
      cacheDir: '.extract-cache',
      dryRun: true,
      storename: 'meeting',
      positional: ['day2.txt'],
    });
  });

  it('accepts the common cache container option for list', () => {
    expect(parseArgs(['list', '--cache-dir', '.extract-cache'])).toEqual({
      command: 'list',
      cacheDir: '.extract-cache',
      positional: [],
    });
  });

  it('parses clean for one store', () => {
    expect(parseArgs(['clean', 'meeting', '-d', '.extract-cache'])).toEqual({
      command: 'clean',
      cacheDir: '.extract-cache',
      storename: 'meeting',
      positional: [],
    });
  });

  it('parses clean --all for the whole container', () => {
    expect(parseArgs(['clean', '--all', '-d', '.extract-cache'])).toEqual({
      command: 'clean',
      cacheDir: '.extract-cache',
      all: true,
      positional: [],
    });
  });

  it.each(['', 'bad/name', '_bad', 'bad name', 'create', 'add', 'extract', 'list', 'clean'])(
    'rejects invalid storename %j',
    (storename) => {
      expect(() => parseArgs(['create', storename, 'notes.txt'])).toThrow(/storename/);
    },
  );

  it.each(['create', 'add', 'extract'])('requires a storename for %s', (command) => {
    expect(() => parseArgs([command])).toThrow(/storename as its first argument/);
  });

  it('requires a storename or --all for clean', () => {
    expect(() => parseArgs(['clean'])).toThrow(/storename or --all/);
    expect(() => parseArgs(['clean', 'meeting', '--all'])).toThrow(/--all does not accept/);
    expect(() => parseArgs(['clean', '--all', 'meeting'])).toThrow(/--all does not accept/);
  });

  it('rejects options belonging to another subcommand', () => {
    expect(() => parseArgs(['create', 'meeting', '--max-tokens', '10', 'notes.txt']))
      .toThrow(/only valid with extract/);
    expect(() => parseArgs(['extract', 'meeting', '--model', 'model', 'query']))
      .toThrow(/only valid with create/);
    expect(() => parseArgs(['add', 'meeting', '--model', 'model', 'notes.txt']))
      .toThrow(/only valid with create/);
    expect(() => parseArgs(['add', 'meeting', '--max-tokens', '10', 'notes.txt']))
      .toThrow(/only valid with extract/);
  });
});
