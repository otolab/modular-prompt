import { describe, it, expect } from 'vitest';
import { RuntimeNotReadyError } from '@modular-prompt/driver';
import {
  formatRuntimeNotReadyMessage,
  MLX_MONOREPO_SETUP,
  MLX_RUNTIME_CLI_SETUP,
} from './runtime-status.js';

describe('runtime-status', () => {
  it('formatRuntimeNotReadyMessage includes setup commands', () => {
    const error = new RuntimeNotReadyError('mlx');
    const message = formatRuntimeNotReadyMessage(error.profile, error.setupCommand);

    expect(message).toContain('mlx Python runtime is not set up');
    expect(message).toContain(error.setupCommand);
    expect(message).toContain(MLX_RUNTIME_CLI_SETUP);
    expect(message).toContain(MLX_MONOREPO_SETUP);
  });
});
