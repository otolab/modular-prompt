import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeCli = join(packageRoot, 'scripts', 'runtime-cli.js');
const driverVersion = (
  JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }
).version;

describe.skipIf(process.platform === 'win32')('runtime CLI PyTorch setup and sync', () => {
  it('seeds, preserves customization, and syncs the runtime project', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'modular-prompt-pytorch-cli-'));
    const fakeBinDirectory = join(temporaryDirectory, 'bin');
    const fakeUvPath = join(fakeBinDirectory, 'uv');
    const uvLogPath = join(temporaryDirectory, 'uv.log');
    const runtimePythonDir = join(
      temporaryDirectory,
      'runtimes',
      'pytorch',
      'python',
    );

    try {
      mkdirSync(fakeBinDirectory, { recursive: true });
      writeFileSync(
        fakeUvPath,
        `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_UV_LOG, args.join(' ') + '\\n');

if (args[0] === '--version') {
  process.exit(0);
}
if (args[0] === 'venv') {
  const environment = process.env.UV_PROJECT_ENVIRONMENT;
  mkdirSync(join(environment, 'bin'), { recursive: true });
  writeFileSync(join(environment, 'bin', 'python'), '');
  process.exit(0);
}
if (args[0] === 'pip' && args[1] === 'list') {
  process.stdout.write('[]');
  process.exit(0);
}
if (args[0] === 'pip' && args[1] === 'install') {
  process.exit(0);
}
process.exit(1);
`,
      );
      chmodSync(fakeUvPath, 0o755);

      const env = {
        ...process.env,
        MODULAR_PROMPT_HOME: temporaryDirectory,
        FAKE_UV_LOG: uvLogPath,
        PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}`,
      };
      const runCli = (...args: string[]) =>
        execFileSync(process.execPath, [runtimeCli, ...args], {
          encoding: 'utf8',
          env,
        });

      runCli('setup', 'pytorch');
      expect(existsSync(join(runtimePythonDir, 'pyproject.toml'))).toBe(true);
      expect(existsSync(join(runtimePythonDir, '__main__.py'))).toBe(true);
      expect(existsSync(join(runtimePythonDir, 'backends', 'base.py'))).toBe(true);
      const manifestPath = join(
        temporaryDirectory,
        'runtimes',
        'pytorch',
        'manifest.json',
      );
      expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
        profile: 'pytorch',
        variant: 'cpu-minimal',
        driverVersion,
      });
      expect(() => runCli('sync', 'pytorch', '--variant', 'other')).toThrow(
        /variant mismatch/,
      );

      writeFileSync(join(runtimePythonDir, 'pyproject.toml'), 'user dependencies\n');
      runCli('setup', 'pytorch');
      expect(readFileSync(join(runtimePythonDir, 'pyproject.toml'), 'utf8')).toBe(
        'user dependencies\n',
      );

      writeFileSync(join(runtimePythonDir, 'backends', 'base.py'), 'user code\n');
      runCli('sync', 'pytorch');
      expect(readFileSync(join(runtimePythonDir, 'pyproject.toml'), 'utf8')).toBe(
        'user dependencies\n',
      );
      expect(readFileSync(join(runtimePythonDir, 'backends', 'base.py'), 'utf8')).toBe(
        readFileSync(
          join(packageRoot, 'src', 'pytorch', 'templates', 'cpu-minimal', 'backends', 'base.py'),
          'utf8',
        ),
      );
      expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
        profile: 'pytorch',
        variant: 'cpu-minimal',
        driverVersion,
      });

      const uvLog = readFileSync(uvLogPath, 'utf8');
      expect(uvLog).toContain('venv --clear --python 3.12');
      expect(uvLog).toContain('pip install');
      expect(uvLog).toContain('torch==2.9.1');
      expect(uvLog).toContain(' .');
      expect(uvLog).not.toContain(' -e ');
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
