import type { RuntimeProfile } from './paths.js';
import {
  collectInstalledPackages,
  readManifest as readManifestCore,
  writeManifest as writeManifestCore,
} from './manifest-core.mjs';

export interface RuntimeManifest {
  profile: RuntimeProfile;
  driverVersion: string;
  platform: string;
  pythonVersion: string;
  createdAt: string;
  /** PyTorch 等の runtime variant（例: cpu-minimal） */
  variant?: string;
  /** セットアップ時に記録した torch バージョン */
  torchVersion?: string;
  packages?: Record<string, string>;
}

export function readManifest(profile: RuntimeProfile): RuntimeManifest | null {
  return readManifestCore(profile) as RuntimeManifest | null;
}

export function writeManifest(profile: RuntimeProfile, manifest: RuntimeManifest): void {
  writeManifestCore(profile, manifest);
}

export { collectInstalledPackages };
