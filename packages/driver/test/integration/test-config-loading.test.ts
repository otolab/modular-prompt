import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('integration test config loading', () => {
  it('releases MLX skip when models.testing.yaml provides a model', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'modular-prompt-testing-'));
    const previousHome = process.env.MODULAR_PROMPT_HOME;

    try {
      process.env.MODULAR_PROMPT_HOME = tempHome;
      writeFileSync(
        join(tempHome, 'models.testing.yaml'),
        `models:
  default:
    provider: mlx
    model: test/testing-model
`
      );

      vi.resetModules();
      const {
        getDriverConfig,
        hasDriverConfig,
      } = await import('./test-config.js');

      expect(hasDriverConfig('mlx')).toBe(true);
      expect(getDriverConfig('mlx')).toMatchObject({
        defaultModel: 'test/testing-model',
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.MODULAR_PROMPT_HOME;
      } else {
        process.env.MODULAR_PROMPT_HOME = previousHome;
      }
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
