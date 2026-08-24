import { describe, it, expect } from 'vitest';
import {
  inputChunk,
  normalizeChunkInput,
  normalizeInputs,
  normalizeMaterial,
  normalizeMaterials,
  normalizeMessage,
  normalizeMessages,
} from './extract-elements.js';

describe('extract-elements', () => {
  it('normalizes minimal inputs to typed elements', () => {
    const material = normalizeMaterial({ title: 'T', content: 'body' }, 0);
    const message = normalizeMessage({ role: 'user', content: 'hi' });
    const chunk = normalizeChunkInput('data', 0);

    expect(material).toMatchObject({
      type: 'material',
      id: 'T',
      title: 'T',
      content: 'body',
      cacheHint: 'immutable',
    });
    expect(message).toMatchObject({
      type: 'message',
      role: 'user',
      content: 'hi',
      cacheHint: 'immutable',
    });
    expect(chunk).toMatchObject({
      type: 'chunk',
      partOf: 'inputs',
      content: 'data',
      cacheHint: 'contextual',
    });
  });

  it('normalizes single or array inputs', () => {
    const material = { title: 'T', content: 'body' };
    const message = { role: 'user' as const, content: 'hi' };
    const chunk = inputChunk('data');

    expect(normalizeMaterials(material)).toHaveLength(1);
    expect(normalizeMessages(message)).toHaveLength(1);
    expect(normalizeInputs(chunk)).toHaveLength(1);
    expect(normalizeInputs('plain-text')).toHaveLength(1);
  });

  it('applies cache hints per element kind during normalization', () => {
    const messages = normalizeMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'tool',
        toolCallId: '1',
        name: 'fn',
        kind: 'text',
        value: 'ok',
      },
    ]);

    expect(messages[0]?.cacheHint).toBe('immutable');
    expect(messages[1]?.cacheHint).toBe('contextual');
  });
});
