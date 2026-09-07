import { describe, expect, it } from 'vitest';
import { resolveStoreDir, validateStorename } from './store.js';

describe('store paths', () => {
  it('resolves a store below the container', () => {
    expect(resolveStoreDir('/tmp/extract-cache', 'meeting'))
      .toBe('/tmp/extract-cache/meeting');
    expect(resolveStoreDir('/tmp/extract-cache', 'project_v2-1'))
      .toBe('/tmp/extract-cache/project_v2-1');
  });

  it.each(['', 'bad/name', '../outside', '-leading', '_leading', 'has space'])(
    'rejects path-unsafe storename %j',
    (storename) => {
      expect(() => validateStorename(storename)).toThrow(/Invalid storename/);
    },
  );

  it.each(['create', 'extract', 'list', 'clean'])('rejects reserved storename %s', (storename) => {
    expect(() => validateStorename(storename)).toThrow(/reserved/);
  });
});
