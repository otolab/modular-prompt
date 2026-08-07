export interface RuntimeManifest {
  profile: string;
  driverVersion: string;
  platform: string;
  pythonVersion: string;
  createdAt: string;
  variant?: string;
  torchVersion?: string;
  packages?: Record<string, string>;
}

export function collectInstalledPackages(
  pythonDir: string,
  venvPath: string,
): Record<string, string> | undefined;

export function readManifest(profile: string): RuntimeManifest | null;
export function writeManifest(profile: string, manifest: RuntimeManifest): void;
