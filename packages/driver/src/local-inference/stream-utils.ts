import { Readable } from 'stream';

export interface StreamMeta {
  prompt_tokens?: number;
  generation_tokens?: number;
}

export const META_MARKER = '\x1e__META__:';

export function extractStreamMeta(content: string): { content: string; meta: StreamMeta } {
  const idx = content.lastIndexOf(META_MARKER);
  if (idx === -1) return { content, meta: {} };
  const jsonStr = content.slice(idx + META_MARKER.length);
  try {
    return { content: content.slice(0, idx), meta: JSON.parse(jsonStr) };
  } catch {
    return { content: content.slice(0, idx), meta: {} };
  }
}

export function createStreamIterable(
  stream: Readable,
  isAborted?: () => boolean,
): {
  iterable: AsyncIterable<string>;
  completion: Promise<{ content: string; meta: StreamMeta; error: Error | null }>;
} {
  const chunks: string[] = [];
  let resolveCompletion: (value: { content: string; meta: StreamMeta; error: Error | null }) => void;
  let settled = false;

  const settle = (error: Error | null) => {
    if (settled) return;
    settled = true;
    const raw = chunks.join('');
    const { content, meta } = extractStreamMeta(raw);
    const aborted = isAborted?.() ?? false;
    resolveCompletion({ content, meta, error: aborted ? null : error });
  };

  const completion = new Promise<{ content: string; meta: StreamMeta; error: Error | null }>((resolve) => {
    resolveCompletion = resolve;
  });

  const iterable = {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      try {
        let buffer = '';
        let markerFound = false;
        for await (const chunk of stream) {
          if (isAborted?.()) {
            break;
          }
          const str = chunk.toString();
          chunks.push(str);
          if (markerFound) continue;
          buffer += str;
          const markerIdx = buffer.indexOf(META_MARKER);
          if (markerIdx !== -1) {
            const text = buffer.slice(0, markerIdx);
            if (text) yield text;
            markerFound = true;
          } else {
            const safeLen = buffer.length - (META_MARKER.length - 1);
            if (safeLen > 0) {
              yield buffer.slice(0, safeLen);
              buffer = buffer.slice(safeLen);
            }
          }
        }
        if (!markerFound && buffer) yield buffer;
      } catch (error) {
        settle(error as Error);
        const aborted = isAborted?.() ?? false;
        if (!aborted) {
          throw error;
        }
      } finally {
        settle(null);
      }
    },
  };

  return { iterable, completion };
}
