import { describe, it, expect } from 'vitest';
import { generateMergedPrompt } from './prompt-builder.js';

describe('generateMergedPrompt', () => {
  it('uses HTML fallback when no special tokens', () => {
    const result = generateMergedPrompt(
      [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
      {},
    );
    expect(result).toContain('<!-- begin of USER -->');
    expect(result).toContain('Hello');
    expect(result).toContain('<!-- begin of ASSISTANT -->');
  });

  it('uses role-specific token pairs', () => {
    const result = generateMergedPrompt(
      [{ role: 'user', content: 'Hello' }],
      {
        user: {
          start: { text: '<|user|>', id: 1 },
          end: { text: '<|/user|>', id: 2 },
        },
      },
    );
    expect(result).toBe('<|user|>\nHello\n<|/user|>');
    expect(result).not.toContain('<!-- begin');
  });

  it('strips message whitespace', () => {
    const result = generateMergedPrompt(
      [{ role: 'user', content: '  padded  ' }],
      {},
    );
    expect(result).toContain('padded');
    expect(result).not.toContain('  padded  ');
  });
});
