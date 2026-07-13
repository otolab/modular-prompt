/**
 * MLX Driver: AbortSignal と cache usage の統合テスト
 *
 * 実 MLX モデルを 1 プロセスで逐次実行する（並行実行禁止）。
 * モデルは DEFAULT_MLX_TEST_MODEL（軽量・逐次実行向け）。
 * tool-call 統合テストの nativeModel / fallbackModel とは別設定。
 *
 * macOS + test-drivers.yaml の mlx セクションが必要。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { platform } from 'os';
import type { PromptModule } from '@modular-prompt/core';
import { compile, createContext } from '@modular-prompt/core';
import { MlxDriver } from '../../src/mlx-ml/mlx-driver.js';
import { MlxCacheController } from '../../src/mlx-ml/mlx-cache-controller.js';
import { hasDriverConfig, DEFAULT_MLX_TEST_MODEL } from './test-config.js';

const isMacOS = platform() === 'darwin';

interface ChatContext {
  userMessage: string;
}

/** abort 検証用: 長文生成を促す（chatModule の短文指示と混ぜない） */
const longOutputModule: PromptModule<ChatContext> = {
  createContext: () => ({ userMessage: '' }),
  instructions: [
    'You are a creative writing assistant. Write long, detailed multi-paragraph responses. Never summarize or stop early.',
  ],
  messages: [
    (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.userMessage }),
  ],
};

const chatModule: PromptModule<ChatContext> = {
  createContext: () => ({ userMessage: '' }),
  instructions: ['You are a helpful assistant. Reply in one short sentence.'],
  messages: [
    { type: 'message', role: 'user', content: 'What is 2+2?' },
    { type: 'message', role: 'assistant', content: '2+2 equals 4.' },
    (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.userMessage }),
  ],
};

async function consumeStream(stream: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

describe.skipIf(!isMacOS || !hasDriverConfig('mlx'))('MLX Abort & Cache Usage Integration', () => {
    let driver: MlxDriver;
    let cacheController: MlxCacheController;
    let model: string;

    beforeAll(async () => {
      model = DEFAULT_MLX_TEST_MODEL;

      cacheController = new MlxCacheController();
      driver = new MlxDriver({ model, cacheController });

      const warmup: PromptModule = {
        messages: [{ type: 'message', role: 'user', content: 'ping' }],
      };
      await driver.query(compile(warmup), { maxTokens: 1 });
    }, 300_000);

    afterAll(async () => {
      await driver.close();
    });

    it('aborts mid-stream, keeps partial content, and resolves result', async () => {
      const controller = new AbortController();
      const ctx = createContext(longOutputModule);
      ctx.userMessage =
        'Write a detailed essay of at least 800 words about the history of computing, ' +
        'from mechanical calculators through mainframes, personal computers, the internet, and modern AI. ' +
        'Use many paragraphs and elaborate on each era. Do not stop early.';

      const { stream, result } = await driver.streamQuery(compile(longOutputModule, ctx), {
        signal: controller.signal,
        maxTokens: 1024,
        temperature: 0.7,
      });

      let received = '';
      for await (const chunk of stream) {
        received += chunk;
        if (received.length >= 50) {
          controller.abort();
          break;
        }
      }

      expect(controller.signal.aborted).toBe(true);

      const final = await result;
      expect(final.finishReason).toBe('error');
      expect(final.content.length).toBeGreaterThan(0);
      expect(final.content.length).toBeLessThan(800);
      console.log('[abort-mid-stream] partial:', final.content.slice(0, 80));
    }, 90_000);

    it('accepts the next query after abort without hanging', async () => {
      const ctx = createContext(chatModule);
      ctx.userMessage = 'Say OK only.';

      const { stream, result } = await driver.streamQuery(compile(chatModule, ctx), {
        maxTokens: 20,
        temperature: 0,
      });
      await consumeStream(stream);

      const final = await result;
      expect(final.finishReason).not.toBe('error');
      expect(final.content).toBeTruthy();
      console.log('[after-abort] next query:', final.content.slice(0, 40));
    }, 60_000);

    it('reports cacheReadTokens when cache is reused', async () => {
      const ctx1 = createContext(chatModule);
      ctx1.userMessage = 'What is TypeScript in one sentence?';
      const ctx2 = createContext(chatModule);
      ctx2.userMessage = 'What is JavaScript in one sentence?';

      const first = await driver.streamQuery(compile(chatModule, ctx1), {
        cache: true,
        maxTokens: 40,
        temperature: 0,
      });
      await consumeStream(first.stream);
      await first.result;

      const second = await driver.streamQuery(compile(chatModule, ctx2), {
        cache: true,
        maxTokens: 40,
        temperature: 0,
      });
      await consumeStream(second.stream);
      const final = await second.result;

      expect(final.usage).toBeDefined();
      expect(final.usage!.promptTokens).toBeGreaterThan(0);
      expect(final.usage!.completionTokens).toBeGreaterThan(0);
      expect(final.usage!.totalTokens).toBe(
        final.usage!.promptTokens + final.usage!.completionTokens,
      );
      expect(final.usage!.cacheReadTokens).toBeGreaterThan(0);

      console.log('[cache-usage]', final.usage);
    }, 120_000);

    it('returns immediately when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const ctx = createContext(chatModule);
      ctx.userMessage = 'This should not run.';

      const { stream, result } = await driver.streamQuery(compile(chatModule, ctx), {
        signal: controller.signal,
        maxTokens: 20,
      });

      const text = await consumeStream(stream);
      const final = await result;

      expect(text).toBe('');
      expect(final.finishReason).toBe('error');
      expect(final.content).toBe('');
    }, 30_000);
});
