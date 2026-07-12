import { describe, it, expect, vi } from 'vitest';
import {
  buildQueryUsage,
  createAbortedStreamResult,
  isAborted,
  watchAbortSignal,
} from './query-utils.js';

describe('buildQueryUsage', () => {
  it('returns undefined when all counts are zero', () => {
    expect(buildQueryUsage({})).toBeUndefined();
    expect(buildQueryUsage({ promptTokens: 0, completionTokens: 0 })).toBeUndefined();
  });

  it('maps prompt and completion tokens', () => {
    expect(buildQueryUsage({ promptTokens: 10, completionTokens: 5 })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('includes cache fields when positive', () => {
    expect(
      buildQueryUsage({
        promptTokens: 100,
        completionTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: 30,
      }),
    ).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 80,
      cacheWriteTokens: 30,
    });
  });

  it('omits zero cache fields', () => {
    expect(
      buildQueryUsage({ promptTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ).toEqual({
      promptTokens: 1,
      completionTokens: 0,
      totalTokens: 1,
    });
  });
});

describe('isAborted', () => {
  it('returns false when signal is undefined', () => {
    expect(isAborted()).toBe(false);
  });

  it('reflects signal.aborted', () => {
    const controller = new AbortController();
    expect(isAborted(controller.signal)).toBe(false);
    controller.abort();
    expect(isAborted(controller.signal)).toBe(true);
  });
});

describe('watchAbortSignal', () => {
  it('invokes onAbort immediately when already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const onAbort = vi.fn();
    const cleanup = watchAbortSignal(controller.signal, onAbort);
    expect(onAbort).toHaveBeenCalledOnce();
    cleanup();
  });

  it('invokes onAbort when signal aborts later', () => {
    const controller = new AbortController();
    const onAbort = vi.fn();
    const cleanup = watchAbortSignal(controller.signal, onAbort);
    expect(onAbort).not.toHaveBeenCalled();
    controller.abort();
    expect(onAbort).toHaveBeenCalledOnce();
    cleanup();
  });
});

describe('createAbortedStreamResult', () => {
  it('resolves with error finish reason and empty stream', async () => {
    const { stream, result } = createAbortedStreamResult();
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
    await expect(result).resolves.toEqual({
      content: '',
      finishReason: 'error',
    });
  });
});
