import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadDefaultProfile } from './profile.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('loadDefaultProfile', () => {
  it('creates the default profile without a bundled YAML file', async () => {
    expect(existsSync(join(packageRoot, 'default-profile.yaml'))).toBe(false);

    const profile = await loadDefaultProfile();

    expect(profile).toEqual({
      module: {
        objective: [
          'チャットアシスタントとして、最新のユーザメッセージに対する返答メッセージを作成する',
        ],
        instructions: [
          '日本語の対話として自然になるように務めます',
          'コンテキストの理解を重視してください',
        ],
      },
      options: {
        temperature: 1.0,
        maxTokens: 4000,
        topP: 0.95,
      },
    });
  });

  it('returns a fresh profile for each call', async () => {
    const first = await loadDefaultProfile();
    const second = await loadDefaultProfile();

    expect(second).not.toBe(first);
    expect(second.module).not.toBe(first.module);
    expect(second.options).not.toBe(first.options);

    first.module?.objective.push('変更された既定値');
    if (first.options) {
      first.options.temperature = 0;
    }

    expect(second.module?.objective).not.toContain('変更された既定値');
    expect(second.options?.temperature).toBe(1.0);
  });
});
