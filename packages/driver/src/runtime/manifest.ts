import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { RuntimeProfile } from './paths.js';
import { getManifestPath, getRuntimeDir } from './paths.js';

export interface RuntimeManifest {
  profile: RuntimeProfile;
  driverVersion: string;
  platform: string;
  pythonVersion: string;
  createdAt: string;
  packages?: Record<string, string>;
}

export function readManifest(profile: RuntimeProfile): RuntimeManifest | null {
  try {
    const raw = readFileSync(getManifestPath(profile), 'utf8');
    return JSON.parse(raw) as RuntimeManifest;
  } catch {
    return null;
  }
}

export function writeManifest(profile: RuntimeProfile, manifest: RuntimeManifest): void {
  mkdirSync(getRuntimeDir(profile), { recursive: true });
  writeFileSync(getManifestPath(profile), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
