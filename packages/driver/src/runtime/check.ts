import { existsSync } from 'fs';
import path from 'path';
import type { RuntimeProfile } from './paths.js';
import { getVenvPath } from './paths.js';

export class RuntimeNotReadyError extends Error {
  readonly profile: RuntimeProfile;
  readonly setupCommand: string;

  constructor(profile: RuntimeProfile) {
    const setupCommand =
      profile === 'mlx'
        ? 'pnpm run setup-mlx -w @modular-prompt/driver'
        : `node node_modules/@modular-prompt/driver/scripts/runtime-cli.js setup ${profile}`;
    super(
      `MLX runtime is not set up at ${getVenvPath(profile)}. ` +
      `Run: ${setupCommand}`
    );
    this.name = 'RuntimeNotReadyError';
    this.profile = profile;
    this.setupCommand = setupCommand;
  }
}

/**
 * MLX 用 Python venv が存在するか確認する
 */
export function isRuntimeReady(profile: RuntimeProfile): boolean {
  const venv = getVenvPath(profile);
  const python = path.join(venv, 'bin', 'python');
  const pythonWin = path.join(venv, 'Scripts', 'python.exe');
  return existsSync(python) || existsSync(pythonWin);
}

export function assertRuntimeReady(profile: RuntimeProfile): void {
  if (!isRuntimeReady(profile)) {
    throw new RuntimeNotReadyError(profile);
  }
}
