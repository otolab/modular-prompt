import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
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

describe('npm pack smoke test', () => {
  it('runs the packed CLI without default-profile.yaml', () => {
    // npm pack + tar extract は CI 環境で 5s を超えることがある
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'modular-prompt-simple-chat-pack-'),
    );
    temporaryDirectories.push(temporaryDirectory);

    execFileSync(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--pack-destination',
        temporaryDirectory,
      ],
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

    const tarballPath = join(temporaryDirectory, tarballName);
    const archiveEntries = execFileSync(
      'tar',
      ['-tzf', tarballPath],
      { encoding: 'utf8' },
    ).split('\n');
    expect(archiveEntries).not.toContain('package/default-profile.yaml');

    const extractedDirectory = join(temporaryDirectory, 'extracted');
    mkdirSync(extractedDirectory);
    execFileSync('tar', ['-xzf', tarballPath, '-C', extractedDirectory]);

    const packedPackageRoot = join(extractedDirectory, 'package');
    expect(existsSync(join(packedPackageRoot, 'default-profile.yaml'))).toBe(false);

    // Reuse the already-installed workspace dependencies. The smoke test is
    // concerned with the packed dist files and does not perform a network install.
    const packageNodeModules = join(packageRoot, 'node_modules');
    if (!existsSync(packageNodeModules)) {
      throw new Error('simple-chat dependencies are not installed');
    }
    symlinkSync(packageNodeModules, join(packedPackageRoot, 'node_modules'), 'dir');

    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const { loadDefaultProfile } = await import('./dist/profile.js'); await loadDefaultProfile();",
      ],
      { cwd: packedPackageRoot, encoding: 'utf8' },
    );

    const helpOutput = execFileSync(
      process.execPath,
      [join(packedPackageRoot, 'dist', 'cli.js'), '--help'],
      { cwd: packedPackageRoot, encoding: 'utf8' },
    );
    expect(helpOutput).toContain('Usage: simple-chat');
  }, 15_000);
});
