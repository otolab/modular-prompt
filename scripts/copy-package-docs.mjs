#!/usr/bin/env node
/**
 * docs/ の正本と package-docs.manifest.json に基づき、
 * packages/<name>/docs/ に npm 同梱用ドキュメントを生成する。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = join(repoRoot, 'docs');
const manifestPath = join(docsRoot, 'package-docs.manifest.json');

function loadManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.packages || typeof manifest.packages !== 'object') {
    throw new Error('package-docs.manifest.json: "packages" is required');
  }
  return manifest;
}

function resolveDestination(packageName, includePath) {
  const packagePrefix = `packages/${packageName}/`;
  const relativePath = includePath.startsWith(packagePrefix)
    ? includePath.slice(packagePrefix.length)
    : includePath;
  return join(repoRoot, 'packages', packageName, 'docs', relativePath);
}

function copyPackageDocs(packageName, includePaths) {
  const docsDir = join(repoRoot, 'packages', packageName, 'docs');
  rmSync(docsDir, { recursive: true, force: true });
  mkdirSync(docsDir, { recursive: true });

  for (const includePath of includePaths) {
    const sourcePath = join(docsRoot, includePath);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing docs source: ${relative(repoRoot, sourcePath)}`);
    }
    const destinationPath = resolveDestination(packageName, includePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath);
  }
}

function main() {
  const requestedPackages = process.argv.slice(2);
  const manifest = loadManifest();
  const packageNames = requestedPackages.length > 0
    ? requestedPackages
    : Object.keys(manifest.packages);

  for (const packageName of packageNames) {
    const entry = manifest.packages[packageName];
    if (!entry) {
      throw new Error(`Unknown package in manifest: ${packageName}`);
    }
    const includePaths = entry.include ?? [];
    copyPackageDocs(packageName, includePaths);
    console.log(`copied docs for ${packageName} (${includePaths.length} files)`);
  }
}

main();
