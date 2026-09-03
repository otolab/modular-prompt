import { describe, it, expect } from 'vitest';
import type { PromptModule } from '@modular-prompt/core';
import type { CacheHandle } from '@modular-prompt/driver';
import { partitionPrompt, TestDriver } from '@modular-prompt/driver';
import {
  prepareSessionCache,
  releaseSessionCache,
  type CacheLifecycleState,
} from './cache-lifecycle.js';
import { createExtractSession } from './create-extract-session.js';
import { compileExtractPrompt } from './compile-extract-prompt.js';
import { inputChunk } from './extract-elements.js';
import { defaultExtractBaseModule } from './modules/default-base-module.js';
import { createMockCacheController } from './test-helpers.js';

describe('cache-lifecycle', () => {
  const corpus = {
    materials: [{ title: 'Doc', content: 'Corpus text' }],
  };

  const customBaseModule: PromptModule = {
    objective: ['Extract information'],
    instructions: ['Follow the cue'],
  };

  it('compileExtractPrompt renders default section templates from typed context', () => {
    const compiled = compileExtractPrompt(
      defaultExtractBaseModule,
      corpus,
      {
        cue: 'Find names',
        inputs: inputChunk('focus on people'),
      },
    );
    const { cacheable, volatile } = partitionPrompt(compiled);
    const serialized = JSON.stringify(compiled);

    expect(serialized).toContain('以下の Prepared Materials');
    expect(serialized).toContain('Corpus text');
    expect(serialized).toContain('"type":"material"');
    expect(serialized).toContain('以下の Input Data');
    expect(serialized).toContain('focus on people');
    expect(serialized).toContain('"type":"chunk"');
    expect(serialized).toContain('以下の出力指示');
    expect(serialized).toContain('Find names');
    expect(cacheable.data.length).toBeGreaterThan(0);
    expect(volatile.output.length).toBeGreaterThan(0);
  });

  it('prepareSessionCache releases superseded handle', async () => {
    const tracking = createMockCacheController();
    const state: CacheLifecycleState = { handle: null, controllerReady: true };

    await prepareSessionCache(
      tracking.controller,
      'test-model',
      defaultExtractBaseModule,
      corpus,
      { cue: 'first' },
      undefined,
      state,
    );
    expect(state.handle?.ref).toBe('cache-1');

    await prepareSessionCache(
      tracking.controller,
      'test-model',
      defaultExtractBaseModule,
      corpus,
      { cue: 'second', inputs: inputChunk('input-line') },
      undefined,
      state,
    );

    expect(state.handle?.ref).toBe('cache-2');
    expect(tracking.releases).toContain('cache-1');
  });

  it('releaseSessionCache clears held handle', () => {
    const tracking = createMockCacheController();
    const state: CacheLifecycleState = {
      handle: { ref: 'cache-held', includes: { instructions: true, dataElementCount: 1, tools: false } },
      controllerReady: true,
    };

    releaseSessionCache(tracking.controller, state);

    expect(tracking.releases).toEqual(['cache-held']);
    expect(state.handle).toBeNull();
  });

  it('custom baseModule merges typed corpus/request sections', () => {
    const compiled = compileExtractPrompt(
      customBaseModule,
      corpus,
      { cue: 'Find names' },
      customBaseModule,
    );
    const serialized = JSON.stringify(compiled);

    expect(serialized).toContain('Corpus text');
    expect(serialized).toContain('Find names');
    expect(serialized).not.toContain('以下の Prepared Materials');
  });
});

describe('createExtractSession cache integration', () => {
  const baseModule: PromptModule = {
    objective: ['Extract information from the provided corpus'],
    instructions: ['Follow the cue to extract relevant data'],
  };

  const corpus = {
    materials: [{
      title: 'Meeting Notes',
      content: 'Alice met Bob in Paris to discuss the project.',
    }],
  };

  it('passes cacheHandle to driver and disables driver-side prepare', async () => {
    const receivedOptions: Array<{ cache?: boolean | 'read-only'; cacheHandle?: CacheHandle }> = [];
    const driver = new TestDriver({
      responses: (_prompt, options) => {
        receivedOptions.push({
          cache: options?.cache,
          cacheHandle: options?.cacheHandle,
        });
        return 'ok';
      },
    });
    const tracking = createMockCacheController();

    const session = createExtractSession({
      driver,
      baseModule,
      corpus,
      cacheController: tracking.controller,
      model: 'test-model',
    });

    await session.extract({ cue: 'List characters' });
    await session.extract({
      cue: 'List locations',
      inputs: inputChunk(JSON.stringify({ hint: 'geo' }, null, 2)),
    });
    await session.close();

    expect(tracking.prepares).toHaveLength(2);
    expect(tracking.prepares[0]?.data?.length ?? 0).toBeGreaterThan(0);
    expect(tracking.prepares[1]?.data?.length ?? 0).toBeGreaterThan(
      tracking.prepares[0]?.data?.length ?? 0,
    );
    expect(receivedOptions).toHaveLength(2);
    expect(receivedOptions[0]?.cache).toBe(false);
    expect(receivedOptions[0]?.cacheHandle?.ref).toBe('cache-1');
    expect(receivedOptions[1]?.cacheHandle?.ref).toBe('cache-2');
    expect(tracking.releases).toContain('cache-1');
    expect(tracking.releases).toContain('cache-2');
    expect(tracking.controller.close).not.toHaveBeenCalled();
  });

  it('does not close cacheController on session close', async () => {
    const driver = new TestDriver({ responses: ['done'] });
    const tracking = createMockCacheController();
    const session = createExtractSession({
      driver,
      baseModule,
      corpus,
      cacheController: tracking.controller,
      model: 'test-model',
    });

    await session.extract({ cue: 'test' });
    await session.close();

    expect(tracking.releases.length).toBeGreaterThan(0);
    expect(tracking.controller.close).not.toHaveBeenCalled();
  });

  it('skips release when close is called with releaseCache: false', async () => {
    const driver = new TestDriver({ responses: ['done'] });
    const tracking = createMockCacheController();
    const session = createExtractSession({
      driver,
      baseModule,
      corpus,
      cacheController: tracking.controller,
      model: 'test-model',
    });

    await session.extract({ cue: 'test' });
    await session.close({ releaseCache: false });

    expect(tracking.releases).toHaveLength(0);
  });
});
