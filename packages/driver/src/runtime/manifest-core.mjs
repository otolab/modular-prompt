import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getManifestPath, getRuntimeDir } from './paths-core.mjs';

function resolveVenvPython(venvPath) {
  return process.platform === 'win32'
    ? join(venvPath, 'Scripts', 'python.exe')
    : join(venvPath, 'bin', 'python');
}

/**
 * @param {string} pythonDir
 * @param {string} venvPath
 * @returns {Record<string, string> | undefined}
 */
export function collectInstalledPackages(pythonDir, venvPath) {
  try {
    const venvPython = resolveVenvPython(venvPath);
    const output = execSync(`uv pip list --format=json --python "${venvPython}"`, {
      cwd: pythonDir,
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
 * @property {string} [variant]
 * @property {string} [torchVersion]
 * @property {Record<string, string>} [packages]
 */
