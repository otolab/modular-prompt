import { describe, expect, it } from 'vitest';
import type { InferenceProcessClientConfig } from './process-client.js';

describe('InferenceProcessClientConfig', () => {
  it('accepts configurable python project and venv paths', () => {
    const config: InferenceProcessClientConfig = {
      modelName: 'test-model',
      pythonProjectDir: '/custom/python',
      venvPath: '/custom/.venv',
      extraSpawnArgs: ['--text-only'],
      loggerPrefix: 'TEST',
    };
    expect(config.pythonProjectDir).toBe('/custom/python');
    expect(config.venvPath).toBe('/custom/.venv');
  });
});
