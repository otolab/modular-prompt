import { describe, it, expect, vi } from 'vitest';
import { merge, compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { CacheHandle, CachePrepareParams, PromptCacheController } from '@modular-prompt/driver';
import { TestDriver } from '@modular-prompt/driver';
import {
  buildCacheModule,
  prepareSessionCache,
  releaseSessionCache,
  resolveModelName,
  type CacheLifecycleState,
} from './cache-lifecycle.js';
import { createExtractSession } from './create-extract-session.js';

function createTrackingCacheController(): {
  controller: PromptCacheController;
  prepares: CachePrepareParams[];
  releases: string[];
  handles: CacheHandle[];
  closed: boolean;
} {
  const prepares: CachePrepareParams[] = [];
  const releases: string[] = [];
  const handles: CacheHandle[] = [];
  let closed = false;
  let counter = 0;

  const controller: PromptCacheController = {
    prepare: vi.fn(async (params) => {
      prepares.push(params);
      counter += 1;
      const handle: CacheHandle = {
        ref: `cache-${counter}`,
        includes: {
          instructions: (params.instructions?.length ?? 0) > 0,
          dataElementCount: params.data?.length ?? 0,
          tools: (params.tools?.length ?? 0) > 0,
        },
        supersedes: counter > 1 ? `cache-${counter - 1}` : undefined,
      };
      handles.push(handle);
      return handle;
    }),
    release: vi.fn((ref: string) => {
      releases.push(ref);
    }),
    close: vi.fn(async () => {
      closed = true;
    }),
  };

  return {
    controller,
    prepares,
    releases,
    handles,
    get closed() {
      return closed;
    },
  };
}

describe('cache-lifecycle', () => {
  const baseModule: PromptModule = {
    objective: ['Extract information'],
    instructions: ['Follow the cue'],
  };
  const corpusModule: PromptModule = {
    materials: [{ type: 'material', id: 'doc', title: 'Doc', content: 'Corpus text' }],
  };

  it('resolveModelName requires model when cache is enabled', () => {
    expect(resolveModelName('test-model', true)).toBe('test-model');
    expect(() => resolveModelName(undefined, true)).toThrow(
      'ExtractSessionOptions.model is required when cacheController is set',
    );
    expect(resolveModelName(undefined, false)).toBeUndefined();
  });

  it('buildCacheModule excludes cue from cacheable module', () => {
    const cacheModule = buildCacheModule(
      baseModule,
      corpusModule,
      { cue: 'Find names', inputs: { hint: 'focus on people' } },
    );
    const compiled = compile(cacheModule);
    const serialized = JSON.stringify(compiled);

    expect(serialized).toContain('Corpus text');
    expect(serialized).toContain('focus on people');
    expect(compiled.output).toHaveLength(0);
  });

  it('prepareSessionCache releases superseded handle', async () => {
    const tracking = createTrackingCacheController();
    const state: CacheLifecycleState = { handle: null, controllerReady: true };
    const cacheModule = merge(baseModule, corpusModule);

    await prepareSessionCache(
      tracking.controller,
      'test-model',
      cacheModule,
      { cue: 'first' },
      state,
    );
    expect(state.handle?.ref).toBe('cache-1');

    const cacheModuleWithInputs = merge(baseModule, corpusModule, {
      inputs: ['input-line'],
    });
    await prepareSessionCache(
      tracking.controller,
      'test-model',
      cacheModuleWithInputs,
      { cue: 'second', inputs: ['input-line'] },
      state,
    );

    expect(state.handle?.ref).toBe('cache-2');
    expect(tracking.releases).toContain('cache-1');
  });

  it('releaseSessionCache clears held handle', () => {
    const tracking = createTrackingCacheController();
    const state: CacheLifecycleState = {
      handle: { ref: 'cache-held', includes: { instructions: true, dataElementCount: 1, tools: false } },
      controllerReady: true,
    };

    releaseSessionCache(tracking.controller, state);

    expect(tracking.releases).toEqual(['cache-held']);
    expect(state.handle).toBeNull();
  });
});

describe('createExtractSession cache integration', () => {
  const baseModule: PromptModule = {
    objective: ['Extract information from the provided corpus'],
    instructions: ['Follow the cue to extract relevant data'],
  };

  const corpus = {
    materials: [{
      type: 'material' as const,
      id: 'doc-1',
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
    const tracking = createTrackingCacheController();

    const session = createExtractSession({
      driver,
      baseModule,
      corpus,
      cacheController: tracking.controller,
      model: 'test-model',
    });

    await session.extract({ cue: 'List characters' });
    await session.extract({ cue: 'List locations', inputs: { hint: 'geo' } });
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
    expect(tracking.closed).toBe(false);
  });

  it('does not close externally provided cacheController', async () => {
    const driver = new TestDriver({ responses: ['done'] });
    const tracking = createTrackingCacheController();
    const session = createExtractSession({
      driver,
      baseModule,
      corpus,
      cacheController: tracking.controller,
      model: 'test-model',
    });

    await session.extract({ cue: 'test' });
    await session.close();

    expect(tracking.closed).toBe(false);
    expect(tracking.releases.length).toBeGreaterThan(0);
  });

  it('remains compatible without cacheController', async () => {
    const driver = new TestDriver({ responses: ['plain'] });
    const session = createExtractSession({ driver, baseModule, corpus });

    const result = await session.extract({ cue: 'test' });
    expect(result.text).toBe('plain');
    await session.close();
  });
});
