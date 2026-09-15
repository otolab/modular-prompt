import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import { InferenceProcessClient } from './process-client.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn();
}

function flushEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('InferenceProcessClient process failures', () => {
  it('propagates startup stderr and rejects requests sent after process exit', async () => {
    const child = new FakeChildProcess();
    const stdinWrite = vi.spyOn(child.stdin, 'write');
    vi.mocked(spawn).mockReturnValue(child as never);

    const client = new InferenceProcessClient({
      modelName: 'Qwen/Qwen3.5-0.8B',
      pythonProjectDir: '/tmp/pytorch',
      venvPath: '/tmp/pytorch/.venv',
      processExitErrorMessage: (code, signal) =>
        `PyTorch process exited unexpectedly (code=${code}, signal=${signal})`,
    });

    const capabilities = client.getCapabilities();
    expect(stdinWrite).toHaveBeenCalledOnce();

    child.stderr.write(
      'RuntimeError: model type qwen3_5 is unavailable; '
        + 'runtime uses transformers 4.57.6; '
        + 'model requires transformers>=5.14.0\n',
    );
    await flushEventLoop();
    child.emit('exit', 1, null);
    child.emit('close', 1, null);

    const error = await capabilities.catch((reason: unknown) => reason);
    if (!(error instanceof Error)) {
      throw new Error(`Expected an Error, received ${String(error)}`);
    }
    expect(error.message).toContain('PyTorch process exited unexpectedly');
    expect(error.message).toContain('transformers 4.57.6');
    expect(error.message).toContain('transformers>=5.14.0');

    const writesAfterExit = stdinWrite.mock.calls.length;
    const secondCapabilities = client.getCapabilities();
    await expect(secondCapabilities).rejects.toThrow(/transformers 4\.57\.6/);
    expect(stdinWrite).toHaveBeenCalledTimes(writesAfterExit);

    await client.exit();
  });
});
