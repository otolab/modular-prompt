import { describe, it, expect, vi } from 'vitest';
import { InferenceRequestQueue } from './request-queue.js';

function parseSentRequest(sendToProcess: ReturnType<typeof vi.fn>) {
  return JSON.parse(String(sendToProcess.mock.calls[0][0]).trim());
}

describe('InferenceRequestQueue.addRenderRequest', () => {
  it('sends render method with messages and mapped options', async () => {
    const sendToProcess = vi.fn();
    const queue = new InferenceRequestQueue({
      sendToProcess,
      createNewStream: () => {
        throw new Error('not used');
      },
      cancelActiveStream: vi.fn(),
    });

    void queue.addRenderRequest(
      [{ role: 'user', content: 'hi' }],
      { primer: 'partial', trust_remote_code: true },
      [{ type: 'function', function: { name: 'foo' } }],
      'low',
    );

    expect(sendToProcess).toHaveBeenCalledOnce();
    expect(parseSentRequest(sendToProcess)).toEqual({
      method: 'render',
      messages: [{ role: 'user', content: 'hi' }],
      options: { primer: 'partial', trust_remote_code: true },
      tools: [{ type: 'function', function: { name: 'foo' } }],
      reasoning_effort: 'low',
    });
  });
});
