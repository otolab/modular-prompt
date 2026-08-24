import { describe, it, expect } from 'vitest';
import { compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { TestDriver } from '@modular-prompt/driver';
import { createExtractSession } from './create-extract-session.js';
import { buildExtractContext } from './extract-context.js';
import { inputChunk } from './extract-elements.js';
import { defaultExtractBaseModule } from './modules/default-base-module.js';
import { createMockCacheController } from './test-helpers.js';

function createSession(driver: TestDriver, overrides?: {
  baseModule?: PromptModule;
  domainModule?: PromptModule;
}) {
  const { controller } = createMockCacheController();
  return createExtractSession({
    driver,
    cacheController: controller,
    model: 'test-model',
    corpus: {
      materials: [{
        title: 'Notes',
        content: 'Alice met Bob in Paris.',
      }],
    },
    ...overrides,
  });
}

describe('defaultExtractBaseModule', () => {
  const sampleContext = buildExtractContext(
    {
      materials: [{
        title: 'Notes',
        content: 'Alice met Bob in Paris.',
      }],
      messages: [{
        role: 'user',
        content: 'Summarize the meeting.',
      }],
    },
    {
      cue: 'List people mentioned',
      inputs: inputChunk(JSON.stringify({ previous: 'none' }, null, 2)),
    },
  );

  it('renders typed section templates from ExtractContext', () => {
    const compiled = compile(defaultExtractBaseModule, sampleContext);
    const serialized = JSON.stringify(compiled);

    expect(serialized).toContain('与えられた資料から、指定された観点の情報を抽出する');
    expect(serialized).toContain('以下の Prepared Materials');
    expect(serialized).toContain('Alice met Bob in Paris');
    expect(serialized).toContain('"type":"material"');
    expect(serialized).toContain('以下の Messages');
    expect(serialized).toContain('Summarize the meeting');
    expect(serialized).toContain('"type":"message"');
    expect(serialized).toContain('以下の Input Data');
    expect(serialized).toContain('"type":"chunk"');
    expect(serialized).toContain('以下の出力指示');
    expect(serialized).toContain('List people mentioned');
  });

  it('omits empty sections from template output', () => {
    const compiled = compile(
      defaultExtractBaseModule,
      buildExtractContext(
        { materials: [{ title: 'T', content: 'body' }] },
        { cue: 'extract' },
      ),
    );
    const serialized = JSON.stringify(compiled);

    expect(serialized).toContain('以下の Prepared Materials');
    expect(serialized).not.toContain('以下の Messages');
    expect(serialized).not.toContain('以下の Input Data');
  });
});

describe('createExtractSession with default / domain modules', () => {
  it('uses default base module and section templates when baseModule is omitted', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = JSON.stringify(prompt);
        expect(serialized).toContain('与えられた資料から、指定された観点の情報を抽出する');
        expect(serialized).toContain('以下の Prepared Materials');
        expect(serialized).toContain('Alice met Bob in Paris');
        expect(serialized).toContain('以下の出力指示');
        expect(serialized).toContain('List people mentioned');
        return 'ok';
      },
    });

    const session = createSession(driver);
    await session.extract({ cue: 'List people mentioned' });
    await session.close();
  });

  it('merges domainModule on top of default base', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = JSON.stringify(prompt);
        expect(serialized).toContain('与えられた資料から、指定された観点の情報を抽出する');
        expect(serialized).toContain('ドメイン固有用語');
        return 'ok';
      },
    });

    const domainModule: PromptModule = {
      terms: ['「PJ」は modular-prompt プロジェクトを指す。'],
      instructions: ['ドメイン固有用語の定義に従って読み取ること。'],
    };

    const session = createSession(driver, { domainModule });
    await session.extract({ cue: 'List project decisions' });
    await session.close();
  });

  it('domainModule merges with explicit baseModule override', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = JSON.stringify(prompt);
        expect(serialized).toContain('custom-base-objective');
        expect(serialized).toContain('domain-addon');
        expect(serialized).not.toContain('与えられた資料から');
        return 'ok';
      },
    });

    const session = createSession(driver, {
      baseModule: { objective: ['custom-base-objective'] },
      domainModule: { guidelines: ['domain-addon'] },
    });
    await session.extract({ cue: 'test' });
    await session.close();
  });
});
