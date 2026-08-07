import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PyTorchDriver } from './pytorch-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import { isRuntimeReady } from '../runtime/index.js';

const shouldSkipPyTorch =
  process.env.SKIP_PYTORCH_TESTS !== 'false' || !isRuntimeReady('pytorch');

describe.skipIf(shouldSkipPyTorch)('PyTorch Driver Integration', () => {
  let driver: PyTorchDriver | null = null;

  beforeAll(() => {
    driver = new PyTorchDriver({
      model: 'hf-internal-testing/tiny-random-gpt2',
      defaultOptions: { maxTokens: 4, temperature: 0 },
    });
  });

  afterAll(async () => {
    if (driver) {
      await driver.close();
    }
  });

  it(
    'should generate a short completion on cpu-minimal runtime',
    async () => {
    if (!driver) {
      throw new Error('Driver not initialized');
    }

    const compiledPrompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: 'Hi',
        },
      ],
      output: [],
    };

    const result = await driver.query(compiledPrompt);
    expect(result.content.length).toBeGreaterThan(0);
  },
    120_000,
  );
});
