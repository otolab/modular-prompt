import { describe, it, expect } from 'vitest';
import { aggregateUsage, aggregateLogEntries } from './usage-utils.js';
import type { LogEntry } from '@modular-prompt/utils';

describe('aggregateUsage', () => {
  it('should return undefined for empty array', () => {
    expect(aggregateUsage([])).toBeUndefined();
  });

  it('should return undefined for all-undefined array', () => {
    expect(aggregateUsage([undefined, undefined])).toBeUndefined();
  });

  it('should return single usage as-is', () => {
    const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    expect(aggregateUsage([usage])).toEqual(usage);
  });

  it('should sum multiple usages', () => {
    const result = aggregateUsage([
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
      { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    ]);
    expect(result).toEqual({
      promptTokens: 350,
      completionTokens: 150,
      totalTokens: 500,
    });
  });

  it('should skip undefined entries', () => {
    const result = aggregateUsage([
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      undefined,
      { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
    ]);
    expect(result).toEqual({
      promptTokens: 300,
      completionTokens: 130,
      totalTokens: 430,
    });
  });
});

describe('aggregateLogEntries', () => {
  const makeEntry = (message: string, level: string = 'info'): LogEntry => ({
    timestamp: new Date(),
    level: level as LogEntry['level'],
    prefix: 'Test',
    context: 'test',
    message,
    args: [],
    formatted: `[Test] ${message}`,
  });

  it('should return undefined for empty array', () => {
    expect(aggregateLogEntries([])).toBeUndefined();
  });

  it('should return undefined for all-undefined array', () => {
    expect(aggregateLogEntries([undefined, undefined])).toBeUndefined();
  });

  it('should flatten multiple arrays', () => {
    const a = [makeEntry('a1'), makeEntry('a2')];
    const b = [makeEntry('b1')];
    const result = aggregateLogEntries([a, b]);
    expect(result).toHaveLength(3);
    expect(result!.map(e => e.message)).toEqual(['a1', 'a2', 'b1']);
  });

  it('should skip undefined entries', () => {
    const a = [makeEntry('a1')];
    const result = aggregateLogEntries([a, undefined, [makeEntry('c1')]]);
    expect(result).toHaveLength(2);
  });

  it('should return undefined for empty sub-arrays', () => {
    expect(aggregateLogEntries([[], []])).toBeUndefined();
  });
});
