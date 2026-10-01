import { describe, expect, it, vi } from 'vitest';
import type { PromptModule } from '@modular-prompt/core';
import type { PromptCacheController } from '@modular-prompt/driver';
import { VertexAIDriver } from '../../driver/src/vertexai/vertexai-driver.js';
import { createExtractSession } from './create-extract-session.js';

describe('createExtractSession with VertexAIDriver cache handles', () => {
  it('passes cache: false + cacheHandle without a second driver prepare', async () => {
    const ref = 'projects/test-project/locations/us-central1/cachedContents/extract-session';
    const prepare = vi.fn().mockResolvedValue({
      ref,
      includes: { instructions: true, dataElementCount: 1, tools: false },
    });
    const cacheController: PromptCacheController = {
      prepare,
      release: vi.fn(),
      close: vi.fn(),
    };
    const driver = new VertexAIDriver({
      project: 'test-project',
      location: 'us-central1',
      model: 'gemini-2.5-flash',
      cacheController,
    });
    const query = vi.spyOn(driver, 'query').mockResolvedValue({
      content: 'extracted',
      finishReason: 'stop',
      usage: {
        promptTokens: 30,
        completionTokens: 3,
        totalTokens: 33,
        cacheReadTokens: 24,
      },
    });
    const baseModule: PromptModule = {
      objective: ['Extract facts'],
      instructions: ['Use the corpus'],
    };

    const session = createExtractSession({
      driver,
      cacheController,
      model: 'gemini-2.5-flash',
      baseModule,
      corpus: { materials: [{ title: 'Notes', content: 'Alice met Bob.' }] },
    });

    const result = await session.extract({ cue: 'List the people' });

    expect(result.text).toBe('extracted');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cache: false,
        cacheHandle: expect.objectContaining({ ref }),
      }),
    );
    expect(result.usage?.cacheReadTokens).toBe(24);

    await session.close();
    await driver.close();
  });
});
