export {
  MODULAR_PROMPT_DIR,
  RUNTIME_PROFILES,
  getModularPromptHome,
  getRuntimesRoot,
  getRuntimeDir,
  getVenvPath,
  getManifestPath,
  getMlxPythonDir,
  getPytorchPythonDir,
  resolvePackageRoot,
  resolvePackageRootFromProcessModule,
  type RuntimeProfile,
} from './paths.js';

export {
  readManifest,
  writeManifest,
  collectInstalledPackages,
  type RuntimeManifest,
} from './manifest.js';

export {
  RuntimeNotReadyError,
  isRuntimeReady,
  assertRuntimeReady,
} from './check.js';

export {
  SETUP_MLX_MONOREPO,
  SETUP_PYTORCH_MONOREPO,
  SETUP_MLX_CLI,
  SETUP_PYTORCH_CLI,
} from './setup-commands.js';
