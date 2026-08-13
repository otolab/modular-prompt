import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapOptionsToPython } from './parameter-mapper.js';

const clientStub = {
  ensureInitialized: vi.fn(),
  getCapabilities: vi.fn(),
  formatTest: vi.fn(),
  tokenize: vi.fn(),
  cachePrefill: vi.fn(),
  chat: vi.fn(),
  completion: vi.fn(),
  generate: vi.fn(),
  exit: vi.fn(),
  cancelActiveRequest: vi.fn(),
  getStatus: vi.fn(),
};

vi.mock('../../local-inference/process-client.js', () => ({
  InferenceProcessClient: vi.fn(function InferenceProcessClient() {
    return clientStub;
  }),
}));

vi.mock('../../runtime/index.js', () => ({
  getMlxPythonDir: vi.fn(() => '/test/mlx/python'),
  getVenvPath: vi.fn(() => '/test/mlx/venv'),
  resolvePackageRootFromProcessModule: vi.fn(() => '/test/pkg'),
}));

import { InferenceProcessClient } from '../../local-inference/process-client.js';
import { MlxProcess } from './index.js';

describe('MlxProcess', () => {
  beforeEach(() => {
    vi.mocked(InferenceProcessClient).mockClear();
  });

  it('constructs InferenceProcessClient with MLX paths and spawn args', () => {
    const process = new MlxProcess('my-model', {
      backend: 'optiq',
      textOnly: true,
      drafterModel: 'draft-model',
      draftBlockSize: 8,
    });

    expect(process.modelName).toBe('my-model');
    expect(InferenceProcessClient).toHaveBeenCalledOnce();
    expect(InferenceProcessClient).toHaveBeenCalledWith({
      modelName: 'my-model',
      pythonProjectDir: '/test/mlx/python',
      venvPath: '/test/mlx/venv',
      runtimeProfile: 'mlx',
      extraSpawnArgs: ['--backend', 'optiq', '--drafter', 'draft-model', '--draft-block-size', '8'],
      loggerPrefix: 'MLX',
      mapSamplingOptions: expect.any(Function),
      processExitErrorMessage: expect.any(Function),
    });
  });

  it('uses --text-only when backend is unset and textOnly is true', () => {
    new MlxProcess('model', { textOnly: true });

    const config = vi.mocked(InferenceProcessClient).mock.calls[0][0];
    expect(config.extraSpawnArgs).toEqual(['--text-only']);
  });

  it('wires mapSamplingOptions to mapOptionsToPython', () => {
    new MlxProcess('model');

    const config = vi.mocked(InferenceProcessClient).mock.calls[0][0];
    const mapped = config.mapSamplingOptions?.({ maxTokens: 32, temperature: 0.5 });

    expect(mapped).toEqual(mapOptionsToPython({ maxTokens: 32, temperature: 0.5 }, true));
  });

  it('uses MLX-specific process exit error message', () => {
    new MlxProcess('model');

    const config = vi.mocked(InferenceProcessClient).mock.calls[0][0];
    expect(config.processExitErrorMessage?.(1, null)).toBe(
      'MLX process exited unexpectedly (code=1, signal=null)',
    );
  });
});
