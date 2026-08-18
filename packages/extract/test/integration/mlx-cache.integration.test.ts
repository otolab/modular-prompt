/**
 * Extract session MLX cache integration test.
 *
 * Verifies that repeated extract() calls against the same corpus reuse KV cache
 * (cacheReadTokens > 0 on the second call).
 */

import { describe, it, expect } from 'vitest';
import { platform } from 'os';
import type { PromptModule } from '@modular-prompt/core';
import { MlxDriver } from '../../../driver/src/mlx-ml/mlx-driver.js';
import { MlxCacheController } from '../../../driver/src/mlx-ml/mlx-cache-controller.js';
import {
  DEFAULT_MLX_TEST_MODEL,
  hasDriverConfig,
} from '../../../driver/test/integration/test-config.js';
import { createExtractSession } from '../../src/create-extract-session.js';

const isMacOS = platform() === 'darwin';

describe.skipIf(!isMacOS || !hasDriverConfig('mlx'))('ExtractSession MLX cache integration', () => {
  const model = DEFAULT_MLX_TEST_MODEL;

  const baseModule: PromptModule = {
    objective: ['Extract factual information from the provided document.'],
    instructions: ['Answer concisely based only on the corpus.'],
  };

  const corpus = {
    materials: [{
      type: 'material' as const,
      id: 'doc-1',
      title: 'Project Notes',
      content: [
        'Alice met Bob in Paris on Monday to discuss the modular-prompt project.',
        'They agreed to add extract sessions with KV cache support.',
        'Charlie joined remotely from Tokyo.',
      ].join(' '),
    }],
  };

  async function createSession() {
    const cacheController = new MlxCacheController();
    const driver = new MlxDriver({ model, cacheController });
    await driver.getCapabilities();
    const session = createExtractSession({
      driver,
      baseModule,
      corpus,
      cacheController,
      model,
    });
    return session;
  }

  it('reports cacheReadTokens > 0 on second extract with same corpus', async () => {
    const session = await createSession();

    const result1 = await session.extract({
      cue: 'List people mentioned in the document.',
      options: { maxTokens: 80, temperature: 0 },
    });
    expect(result1.text).toBeTruthy();
    expect(result1.index).toBe(0);

    const result2 = await session.extract({
      cue: 'List cities mentioned in the document.',
      options: { maxTokens: 80, temperature: 0 },
    });
    expect(result2.text).toBeTruthy();
    expect(result2.index).toBe(1);
    expect(result2.usage?.cacheReadTokens).toBeGreaterThan(0);

    await session.close();
  }, 120_000);

  it('extends cache incrementally when inputs are provided', async () => {
    const session = await createSession();

    const result1 = await session.extract({
      cue: 'Summarize the meeting in one sentence.',
      options: { maxTokens: 80, temperature: 0 },
    });

    const result2 = await session.extract({
      cue: 'What was agreed about extract sessions?',
      inputs: { previousSummary: result1.text },
      options: { maxTokens: 80, temperature: 0 },
    });

    expect(result2.usage?.cacheReadTokens).toBeGreaterThan(0);
    await session.close();
  }, 120_000);
});
