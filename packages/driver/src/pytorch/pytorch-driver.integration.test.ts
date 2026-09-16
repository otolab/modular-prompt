import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PyTorchDriver } from './pytorch-driver.js';
import { PyTorchCacheController } from './pytorch-cache-controller.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import { isRuntimeReady, readManifest } from '../runtime/index.js';

const shouldSkipPyTorch =
  process.env.SKIP_PYTORCH_TESTS !== 'false' || !isRuntimeReady('pytorch');
const pytorchRuntimeVariant = readManifest('pytorch')?.variant;
const shouldSkipCpuCache = shouldSkipPyTorch || pytorchRuntimeVariant !== 'cpu-minimal';
const shouldSkipCudaCache = shouldSkipPyTorch || pytorchRuntimeVariant !== 'cuda';
const integrationModel = process.env.PYTORCH_INTEGRATION_MODEL ?? 'hf-internal-testing/tiny-random-gpt2';

const integrationOptions = {
  mode: 'chat' as const,
  maxTokens: 2,
  temperature: 0,
};

function createCachePrompt(immutableData: string[]): CompiledPrompt {
  return {
    instructions: [
      {
        type: 'text',
        content: 'Answer concisely and follow the requested format.',
        cacheHint: 'static',
      },
    ],
    data: [
      ...immutableData.map((content) => ({
        type: 'text' as const,
        content,
        cacheHint: 'immutable' as const,
      })),
      {
        type: 'message',
        role: 'user',
        content: 'Reply with a short answer.',
        cacheHint: 'contextual',
      },
    ],
    output: [],
  };
}

function expectCacheUsage(result: { usage?: {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
} }): void {
  expect(result.usage?.cacheReadTokens ?? 0).toBeGreaterThan(0);
  expect(result.usage?.cacheWriteTokens ?? 0).toBeGreaterThan(0);
}

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

describe.skipIf(shouldSkipCpuCache)('PyTorch CPU cache integration', () => {
  it('runs usage, disk restart hit, and incremental prefill through the real LIP', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'modular-prompt-pytorch-cpu-cache-'));
    const basePrompt = createCachePrompt(['Stable context.']);
    const extendedPrompt = createCachePrompt(['Stable context.', 'Additional context.']);
    const controller = new PyTorchCacheController({ cacheDir });
    let driver: PyTorchDriver | undefined;
    let restartedDriver: PyTorchDriver | undefined;

    try {
      driver = new PyTorchDriver({
        model: integrationModel,
        device: 'cpu',
        defaultOptions: integrationOptions,
        cacheController: controller,
      });

      const first = await driver.query(basePrompt, { cache: true });
      expectCacheUsage(first);

      const memoryHit = await driver.query(basePrompt, { cache: true });
      expect(memoryHit.usage?.cacheReadTokens ?? 0).toBeGreaterThan(0);
      expect(memoryHit.usage?.cacheWriteTokens ?? 0).toBe(0);

      const incremental = await driver.query(extendedPrompt, { cache: true });
      expectCacheUsage(incremental);
      expect(controller.getStats().incremental).toBeGreaterThan(0);

      await driver.close();
      driver = undefined;

      const restartedController = new PyTorchCacheController({ cacheDir });
      restartedDriver = new PyTorchDriver({
        model: integrationModel,
        device: 'cpu',
        defaultOptions: integrationOptions,
        cacheController: restartedController,
      });
      const diskHit = await restartedDriver.query(basePrompt, { cache: true });
      expect(diskHit.usage?.cacheReadTokens ?? 0).toBeGreaterThan(0);
      expect(diskHit.usage?.cacheWriteTokens ?? 0).toBe(0);
      expect(restartedController.getStats().diskHit).toBeGreaterThan(0);
    } finally {
      await restartedDriver?.close();
      await driver?.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe.skipIf(shouldSkipCudaCache)('PyTorch CUDA cache integration', () => {
  it('runs process-local usage through the plain-prefill fallback', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'modular-prompt-pytorch-cuda-cache-'));
    const controller = new PyTorchCacheController({ cacheDir });
    const prompt = createCachePrompt(['CUDA process-local context.']);
    let driver: PyTorchDriver | undefined;
    let restartedDriver: PyTorchDriver | undefined;

    try {
      driver = new PyTorchDriver({
        model: integrationModel,
        device: 'cuda',
        defaultOptions: integrationOptions,
        cacheController: controller,
      });

      const first = await driver.query(prompt, { cache: true });
      expectCacheUsage(first);
      expect(readdirSync(cacheDir).some((name) => name.endsWith('.pytorch-cache'))).toBe(false);

      await driver.close();
      driver = undefined;

      const restartedController = new PyTorchCacheController({ cacheDir });
      restartedDriver = new PyTorchDriver({
        model: integrationModel,
        device: 'cuda',
        defaultOptions: integrationOptions,
        cacheController: restartedController,
      });
      const afterRestart = await restartedDriver.query(prompt, { cache: true });
      expectCacheUsage(afterRestart);
      expect(restartedController.getStats().fresh).toBeGreaterThan(0);
      expect(existsSync(join(cacheDir, 'cache-index.json'))).toBe(true);
    } finally {
      await restartedDriver?.close();
      await driver?.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 180_000);
});
