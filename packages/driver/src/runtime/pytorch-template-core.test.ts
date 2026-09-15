import { describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seedPytorchTemplate, syncPytorchTemplate } from './pytorch-template-core.mjs';

describe('PyTorch template runtime files', () => {
  it('seeds a new runtime and preserves user files on subsequent syncs', () => {
    const root = mkdtempSync(join(tmpdir(), 'modular-prompt-pytorch-template-'));
    const templateDir = join(root, 'template');
    const runtimeDir = join(root, 'runtime', 'python');

    try {
      mkdirSync(join(templateDir, 'backends'), { recursive: true });
      writeFileSync(join(templateDir, 'pyproject.toml'), 'template dependencies\n');
      writeFileSync(join(templateDir, 'uv.lock'), 'template lock\n');
      writeFileSync(join(templateDir, 'backends', 'base.py'), 'template code v1\n');

      seedPytorchTemplate(templateDir, runtimeDir);
      expect(readFileSync(join(runtimeDir, 'pyproject.toml'), 'utf8')).toBe(
        'template dependencies\n',
      );
      expect(readFileSync(join(runtimeDir, 'backends', 'base.py'), 'utf8')).toBe(
        'template code v1\n',
      );

      writeFileSync(join(runtimeDir, 'pyproject.toml'), 'user dependencies\n');
      writeFileSync(join(runtimeDir, 'uv.lock'), 'user lock\n');
      writeFileSync(join(templateDir, 'pyproject.toml'), 'template dependencies v2\n');
      writeFileSync(join(templateDir, 'uv.lock'), 'template lock v2\n');
      writeFileSync(join(templateDir, 'backends', 'base.py'), 'template code v2\n');

      syncPytorchTemplate(templateDir, runtimeDir);
      expect(readFileSync(join(runtimeDir, 'pyproject.toml'), 'utf8')).toBe(
        'user dependencies\n',
      );
      expect(readFileSync(join(runtimeDir, 'uv.lock'), 'utf8')).toBe('user lock\n');
      expect(readFileSync(join(runtimeDir, 'backends', 'base.py'), 'utf8')).toBe(
        'template code v2\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('copies missing preserved files when seeding an existing runtime directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'modular-prompt-pytorch-template-'));
    const templateDir = join(root, 'template');
    const runtimeDir = join(root, 'runtime', 'python');

    try {
      mkdirSync(templateDir, { recursive: true });
      mkdirSync(runtimeDir, { recursive: true });
      writeFileSync(join(templateDir, 'pyproject.toml'), '[project]\nname = "template"\n');
      seedPytorchTemplate(templateDir, runtimeDir);
      expect(readFileSync(join(runtimeDir, 'pyproject.toml'), 'utf8')).toContain(
        'name = "template"',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
