import { describe, it, expect } from 'vitest';
import { mergeMlxQueryOptions, toMlxSamplingOptions } from './mlx-options.js';
import { mapOptionsToPython } from './process/parameter-mapper.js';

describe('mergeMlxQueryOptions', () => {
  it('merges defaults with per-query overrides', () => {
    const merged = mergeMlxQueryOptions(
      { mode: 'instruct', temperature: 0.1, maxTokens: 50 },
      { temperature: 0.8, topP: 0.9 },
    );

    expect(merged).toEqual({
      mode: 'instruct',
      temperature: 0.8,
      maxTokens: 50,
      topP: 0.9,
    });
  });
});

describe('toMlxSamplingOptions', () => {
  it('extracts only Python-facing sampling parameters', () => {
    const merged = mergeMlxQueryOptions(
      {
        mode: 'instruct',
        maxTokens: 128,
        temperature: 0.2,
        repetitionPenalty: 1.1,
        tools: [{ name: 'fn' }],
        signal: undefined,
        cache: true,
        apiStrategy: 'force-chat',
      },
      {},
    );

    expect(toMlxSamplingOptions(merged)).toEqual({
      maxTokens: 128,
      temperature: 0.2,
      repetitionPenalty: 1.1,
    });
    expect(toMlxSamplingOptions(merged)).not.toHaveProperty('mode');
  });
});

describe('mode is not forwarded to Python', () => {
  it('mapOptionsToPython rejects mode in strict mode', () => {
    expect(() => mapOptionsToPython({ mode: 'instruct' } as never, true)).toThrow('Unknown parameter');
  });
});
