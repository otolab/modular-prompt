import type { RuntimeProfile } from './paths.js';
import { getVenvPath, isRuntimeReady } from './paths.js';

export class RuntimeNotReadyError extends Error {
  readonly profile: RuntimeProfile;
  readonly setupCommand: string;

  constructor(profile: RuntimeProfile) {
    const setupCommand =
      profile === 'mlx'
        ? 'pnpm run setup-mlx -w @modular-prompt/driver'
        : profile === 'pytorch'
          ? 'pnpm run setup-pytorch -w @modular-prompt/driver'
          : `node node_modules/@modular-prompt/driver/scripts/runtime-cli.js setup ${profile}`;
    super(
      `${profile} runtime is not set up at ${getVenvPath(profile)}. ` +
      `Run: ${setupCommand}`
    );
    this.name = 'RuntimeNotReadyError';
    this.profile = profile;
    this.setupCommand = setupCommand;
  }
}

export { isRuntimeReady };

export function assertRuntimeReady(profile: RuntimeProfile): void {
  if (!isRuntimeReady(profile)) {
    throw new RuntimeNotReadyError(profile);
  }
}
