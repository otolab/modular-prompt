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

    const streamPromise = queue.addGenerateRequest('hello prompt');
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

    await queue.addGenerateRequest('first prompt');
    queue.onRequestCompleted();

    await queue.addGenerateRequest('second prompt');
    expect(sendToProcess).toHaveBeenCalledTimes(2);
  });
});
