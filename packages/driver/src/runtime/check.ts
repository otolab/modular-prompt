import type { RuntimeProfile } from './paths.js';
import { getVenvPath, isRuntimeReady } from './paths.js';
import {
  SETUP_MLX_MONOREPO,
  SETUP_PYTORCH_MONOREPO,
  SETUP_MLX_CLI,
} from './setup-commands.js';

export class RuntimeNotReadyError extends Error {
  readonly profile: RuntimeProfile;
  readonly setupCommand: string;

  constructor(profile: RuntimeProfile) {
    const setupCommand =
      profile === 'mlx'
        ? SETUP_MLX_MONOREPO
        : profile === 'pytorch'
          ? SETUP_PYTORCH_MONOREPO
          : SETUP_MLX_CLI.replace(' setup mlx', ` setup ${profile}`);
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
