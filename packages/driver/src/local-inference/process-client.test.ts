import { describe, expect, it, vi } from 'vitest';
import { ProcessCommunication } from './process-communication.js';
import type { InferenceProcessClientConfig } from './process-client.js';

vi.mock('./process-communication.js', () => ({
  ProcessCommunication: vi.fn().mockImplementation(() => ({
    sendToProcess: vi.fn(),
    createNewStream: vi.fn(),
    cancelActiveStream: vi.fn(),
    isStreamingActive: vi.fn(() => false),
    isJsonBuffering: vi.fn(() => false),
    exit: vi.fn(),
  })),
}));

vi.mock('../runtime/index.js', () => ({
  assertRuntimeReady: vi.fn(),
}));

import { InferenceProcessClient } from './process-client.js';

describe('InferenceProcessClient', () => {
  it('passes python project dir, venv path, and spawn args to ProcessCommunication', () => {
    new InferenceProcessClient({
      modelName: 'test-model',
      pythonProjectDir: '/custom/python',
      venvPath: '/custom/.venv',
      extraSpawnArgs: ['--text-only'],
      loggerPrefix: 'TEST',
    });

    expect(ProcessCommunication).toHaveBeenCalledWith(
      expect.objectContaining({
        pythonProjectDir: '/custom/python',
        venvPath: '/custom/.venv',
        modelName: 'test-model',
        extraArgs: ['--text-only'],
        loggerPrefix: 'TEST',
      }),
      expect.any(Object),
    );
  });

  it('accepts configurable paths in InferenceProcessClientConfig', () => {
    const config: InferenceProcessClientConfig = {
      modelName: 'test-model',
      pythonProjectDir: '/custom/python',
      venvPath: '/custom/.venv',
    };
    expect(config.pythonProjectDir).toBe('/custom/python');
  });
});
