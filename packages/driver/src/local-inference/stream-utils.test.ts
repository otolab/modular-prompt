import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { extractStreamMeta, createStreamIterable, META_MARKER } from './stream-utils.js';

describe('stream-utils', () => {
  it('extractStreamMeta parses trailing meta JSON', () => {
    const raw = `hello${META_MARKER}{"prompt_tokens":10,"generation_tokens":3}`;
    const { content, meta } = extractStreamMeta(raw);
    expect(content).toBe('hello');
    expect(meta).toEqual({ prompt_tokens: 10, generation_tokens: 3 });
  });

  it('extractStreamMeta returns content unchanged when no marker', () => {
    const { content, meta } = extractStreamMeta('plain text');
    expect(content).toBe('plain text');
    expect(meta).toEqual({});
  });

  it('createStreamIterable strips meta from yielded chunks', async () => {
    const stream = Readable.from([`partial `, `answer${META_MARKER}{"prompt_tokens":1,"generation_tokens":2}`]);
    const { iterable, completion } = createStreamIterable(stream);

    const chunks: string[] = [];
    for await (const chunk of iterable) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('partial answer');
    await expect(completion).resolves.toMatchObject({
      content: 'partial answer',
      meta: { prompt_tokens: 1, generation_tokens: 2 },
      error: null,
    });
  });
});
