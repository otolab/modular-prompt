import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';
import { InferenceRequestQueue } from './request-queue.js';

function createRequestQueue(overrides?: Partial<{
  cancelActiveStream: () => void;
}>) {
  const cancelActiveStream = overrides?.cancelActiveStream ?? vi.fn();
  const sendToProcess = vi.fn();
  const queue = new InferenceRequestQueue({
    sendToProcess,
    createNewStream: () => new Readable({ read() {} }),
    cancelActiveStream,
  });
  return { queue, cancelActiveStream, sendToProcess };
}

describe('InferenceRequestQueue.cancelActiveRequest', () => {
  it('calls cancelActiveStream while a streaming request is in flight', async () => {
    const { queue, cancelActiveStream } = createRequestQueue();

    const streamPromise = queue.addChatRequest([{ role: 'user', content: 'hi' }]);
    await streamPromise;

    queue.cancelActiveRequest();
    expect(cancelActiveStream).toHaveBeenCalledOnce();
  });

  it('does nothing when the queue is idle', () => {
    const { queue, cancelActiveStream } = createRequestQueue();

    queue.cancelActiveRequest();
    expect(cancelActiveStream).not.toHaveBeenCalled();
  });

  it('unblocks the queue after request completion following cancel', async () => {
    const { queue, sendToProcess } = createRequestQueue();

    await queue.addChatRequest([{ role: 'user', content: 'first' }]);
    queue.onRequestCompleted();

    await queue.addChatRequest([{ role: 'user', content: 'second' }]);
    expect(sendToProcess).toHaveBeenCalledTimes(2);
  });
});
