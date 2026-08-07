import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';
import { InferenceRequestQueue } from './request-queue.js';

describe('InferenceRequestQueue.addGenerateRequest', () => {
  it('sends generate method with formatted prompt', async () => {
    const sendToProcess = vi.fn();
    const queue = new InferenceRequestQueue({
      sendToProcess,
      createNewStream: () => new Readable({ read() {} }),
      cancelActiveStream: vi.fn(),
    });

    const streamPromise = queue.addGenerateRequest('Hello, world', { max_tokens: 8 });
    await streamPromise;

    expect(sendToProcess).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(sendToProcess.mock.calls[0][0]).trim());
    expect(payload).toEqual({
      method: 'generate',
      prompt: 'Hello, world',
      options: { max_tokens: 8 },
    });
  });
});
