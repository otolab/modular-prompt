import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('runtime CLI bin', () => {
  it('publishes modular-prompt-runtime in npm pack', () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'modular-prompt-driver-pack-'),
    );
    temporaryDirectories.push(temporaryDirectory);

    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', temporaryDirectory],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          COREPACK_ENABLE_PROJECT_SPEC: '0',
          npm_config_cache: join(temporaryDirectory, 'npm-cache'),
        },
      },
    );

    const tarballName = readdirSync(temporaryDirectory).find((name) =>
      name.endsWith('.tgz'),
    );
    if (!tarballName) {
      throw new Error('npm pack did not create a tarball');
    }

    const packedPackageJson = execFileSync(
      'tar',
      ['-xOf', join(temporaryDirectory, tarballName), 'package/package.json'],
      { encoding: 'utf8' },
    );
    const { bin } = JSON.parse(packedPackageJson) as { bin: Record<string, string> };

    expect(bin['modular-prompt-runtime']).toBe('./scripts/runtime-cli.js');
  });

  it('documents modular-prompt-runtime in package.json', () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    ) as { bin: Record<string, string> };

    expect(packageJson.bin['modular-prompt-runtime']).toBe('./scripts/runtime-cli.js');
  });
});
