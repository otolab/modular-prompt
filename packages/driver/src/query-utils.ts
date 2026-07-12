import type { QueryResult, StreamResult } from './types.js';

/**
 * Token usage fields for {@link QueryResult.usage}.
 * Drivers map provider-specific stats into this shape.
 */
export interface UsageCounts {
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Build {@link QueryResult.usage} from raw token counts.
 * Omits the field when all counts are zero/undefined.
 */
export function buildQueryUsage(counts: UsageCounts): QueryResult['usage'] | undefined {
  const promptTokens = counts.promptTokens ?? 0;
  const completionTokens = counts.completionTokens ?? 0;
  const cacheReadTokens = counts.cacheReadTokens ?? 0;
  const cacheWriteTokens = counts.cacheWriteTokens ?? 0;

  if (
    promptTokens === 0 &&
    completionTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheWriteTokens === 0
  ) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  };
}

/** Whether an {@link AbortSignal} is already aborted. */
export function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

/**
 * Register an abort listener. Invokes `onAbort` immediately when already aborted.
 * Returns a cleanup function.
 */
export function watchAbortSignal(
  signal: AbortSignal | undefined,
  onAbort: () => void,
): () => void {
  if (!signal) {
    return () => {};
  }
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  const handler = () => onAbort();
  signal.addEventListener('abort', handler);
  return () => signal.removeEventListener('abort', handler);
}

/**
 * StreamResult for a request that was aborted before inference started.
 * `result` resolves (does not reject) with `finishReason: 'error'`.
 */
export function createAbortedStreamResult(
  extras: Partial<QueryResult> = {},
): StreamResult {
  const emptyStream: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {},
  };
  return {
    stream: emptyStream,
    result: Promise.resolve({
      content: '',
      finishReason: 'error',
      ...extras,
    }),
  };
}
