import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getManifestPath, getRuntimeDir } from './paths-core.mjs';

/**
 * @param {string} pythonDir
 * @param {string} venvPath
 * @returns {Record<string, string> | undefined}
 */
export function collectInstalledPackages(pythonDir, venvPath) {
  try {
    const output = execSync('uv pip list --format=json', {
      cwd: pythonDir,
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: venvPath,
      },
      encoding: 'utf8',
    });
    const list = JSON.parse(output);
    /** @type {Record<string, string>} */
    const packages = {};
    for (const pkg of list) {
      packages[pkg.name] = pkg.version;
    }
    return packages;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} profile
 * @returns {import('./manifest-core.mjs').RuntimeManifest | null}
 */
export function readManifest(profile) {
  try {
    const raw = readFileSync(getManifestPath(profile), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} profile
 * @param {import('./manifest-core.mjs').RuntimeManifest} manifest
 */
export function writeManifest(profile, manifest) {
  mkdirSync(getRuntimeDir(profile), { recursive: true });
  writeFileSync(getManifestPath(profile), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * @typedef {Object} RuntimeManifest
 * @property {string} profile
 * @property {string} driverVersion
 * @property {string} platform
 * @property {string} pythonVersion
 * @property {string} createdAt
 * @property {Record<string, string>} [packages]
 */
