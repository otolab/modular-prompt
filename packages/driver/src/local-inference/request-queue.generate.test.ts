import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';
import { InferenceRequestQueue } from './request-queue.js';

function createQueue(sendToProcess = vi.fn()) {
  return new InferenceRequestQueue({
    sendToProcess,
    createNewStream: () => new Readable({ read() {} }),
    cancelActiveStream: vi.fn(),
  });
}

function parseSentRequest(sendToProcess: ReturnType<typeof vi.fn>) {
  return JSON.parse(String(sendToProcess.mock.calls[0][0]).trim());
}

describe('InferenceRequestQueue.addGenerateRequest', () => {
  it('sends generate method with string prompt', async () => {
    const sendToProcess = vi.fn();
    const queue = createQueue(sendToProcess);

    await queue.addGenerateRequest('Hello, world', { max_tokens: 8 });

    expect(sendToProcess).toHaveBeenCalledOnce();
    expect(parseSentRequest(sendToProcess)).toEqual({
      method: 'generate',
      prompt: 'Hello, world',
      options: { max_tokens: 8 },
    });
  });

  it('sends generate method with token id prompt', async () => {
    const sendToProcess = vi.fn();
    const queue = createQueue(sendToProcess);

    await queue.addGenerateRequest([1, 2, 3], { temperature: 0.5 });

    expect(parseSentRequest(sendToProcess)).toEqual({
      method: 'generate',
      prompt: [1, 2, 3],
      options: { temperature: 0.5 },
    });
  });

  it('includes images and maxImageSize when provided', async () => {
    const sendToProcess = vi.fn();
    const queue = createQueue(sendToProcess);

    await queue.addGenerateRequest('vlm prompt', undefined, ['/tmp/a.png'], 512);

    expect(parseSentRequest(sendToProcess)).toEqual({
      method: 'generate',
      prompt: 'vlm prompt',
      images: ['/tmp/a.png'],
      maxImageSize: 512,
    });
  });
});
