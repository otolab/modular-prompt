/**
 * MLX Driver KVキャッシュ統合テスト
 *
 * enableCaching: true で実MLXモデルに対してキャッシュが正常動作することを検証する。
 * PromptModule + compile を使用してプロンプトを構築（simple-chatパターン）。
 *
 * - テストケース群1: 会話履歴（messages）のキャッシュ
 *   静的な会話履歴はcacheable prefix、動的な最新メッセージはvolatile
 * - テストケース群2: state/materials構成でのキャッシュ
 *   state (Current State section) がdata内のcacheable prefixを遮断する挙動
 *
 * test-drivers.yaml に mlx.nativeModel の設定が必要。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MlxDriver } from '../../src/mlx-ml/mlx-driver.js';
import { MlxCacheController } from '../../src/mlx-ml/mlx-cache-controller.js';
import { hasDriverConfig, getDriverConfig } from './test-config.js';
import type { PromptModule } from '@modular-prompt/core';
import { compile, createContext } from '@modular-prompt/core';
import { extractCacheablePrefix } from '../../src/cache-utils.js';
import { platform } from 'os';

const isMacOS = platform() === 'darwin';

interface ChatContext {
  userMessage: string;
}

interface DocContext {
  stateInfo: string;
  userMessage: string;
}

describe.skipIf(!isMacOS || !hasDriverConfig('mlx'))('MLX Cache Integration', () => {
  let driver: MlxDriver;
  let cacheController: MlxCacheController;
  let model: string;

  beforeAll(async () => {
    const config = getDriverConfig('mlx')!;
    model = config.nativeModel!;

    cacheController = new MlxCacheController();
    driver = new MlxDriver({ model, cacheController });

    const warmup: PromptModule = {
      messages: [{ type: 'message', role: 'user', content: 'hello' }],
    };
    await driver.query(compile(warmup), { maxTokens: 1 });
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  });

  // ================================================================
  // テストケース群1: MessageElementsのキャッシュ
  // simple-chatパターン: instructions + messages (static history + dynamic latest)
  //
  // compile が静的要素に cacheHint: 'static'、DynamicContent由来の要素に
  // cacheHint: 'contextual' を自動付与する。extractCacheablePrefix は
  // 'contextual' で途切れるため、静的な会話履歴がキャッシュ対象になる。
  // ================================================================
  describe('MessageElements caching', () => {
    const chatModule: PromptModule<ChatContext> = {
      createContext: () => ({ userMessage: '' }),
      instructions: ['You are a helpful assistant. Respond concisely in one sentence.'],
      messages: [
        { type: 'message', role: 'user', content: 'What is TypeScript?' },
        { type: 'message', role: 'assistant', content: 'TypeScript is a typed superset of JavaScript that adds static type checking.' },
        { type: 'message', role: 'user', content: 'What about its type system?' },
        { type: 'message', role: 'assistant', content: 'It uses structural typing with interfaces, generics, and union types.' },
        (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.userMessage }),
      ],
    };

    it('should cache static history and handle different latest messages', async () => {
      const ctx1 = createContext(chatModule);
      ctx1.userMessage = 'How do I define an interface?';
      const compiled1 = compile(chatModule, ctx1);

      // キャッシュ構造の検証: instructions + Messages section + 4つの静的メッセージ
      const prefix = extractCacheablePrefix(compiled1);
      expect(prefix.instructions.length).toBeGreaterThan(0);
      expect(prefix.data.length).toBe(5); // Messages SectionElement + 4 static MessageElements

      // cacheControllerのprepare()でhandle.includesを検証
      const handle = await cacheController.prepare({
        model,
        instructions: prefix.instructions,
        data: prefix.data,
      });
      expect(handle.includes.instructions).toBe(true);
      expect(handle.includes.dataElementCount).toBe(5);
      expect(handle.includes.tools).toBe(false);

      const result1 = await driver.query(compiled1, { maxTokens: 100, temperature: 0 });
      expect(result1.content).toBeTruthy();
      expect(result1.finishReason).toBeDefined();

      // 同じ会話履歴で異なる最新メッセージ → キャッシュ再利用
      const ctx2 = createContext(chatModule);
      ctx2.userMessage = 'What are mapped types?';
      const result2 = await driver.query(compile(chatModule, ctx2), { maxTokens: 100, temperature: 0 });
      expect(result2.content).toBeTruthy();
      expect(result2.finishReason).toBeDefined();

      console.log('[cache-messages] result1:', result1.content?.slice(0, 80));
      console.log('[cache-messages] result2:', result2.content?.slice(0, 80));
    }, 60_000);

    it('should handle conversation history growth (cache key changes)', async () => {
      const extendedModule: PromptModule<ChatContext> = {
        createContext: () => ({ userMessage: '' }),
        instructions: ['You are a helpful assistant. Respond concisely in one sentence.'],
        messages: [
          { type: 'message', role: 'user', content: 'What is TypeScript?' },
          { type: 'message', role: 'assistant', content: 'TypeScript is a typed superset of JavaScript that adds static type checking.' },
          { type: 'message', role: 'user', content: 'What about its type system?' },
          { type: 'message', role: 'assistant', content: 'It uses structural typing with interfaces, generics, and union types.' },
          { type: 'message', role: 'user', content: 'Can you explain generics?' },
          { type: 'message', role: 'assistant', content: 'Generics let you write reusable code that works with multiple types.' },
          (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.userMessage }),
        ],
      };

      const ctx = createContext(extendedModule);
      ctx.userMessage = 'Show me a generic function example.';
      const compiled = compile(extendedModule, ctx);

      // 履歴が増えた分、キャッシュ対象のdata要素も増える
      const prefix = extractCacheablePrefix(compiled);
      expect(prefix.data.length).toBe(7); // Messages SectionElement + 6 static MessageElements

      const result = await driver.query(compiled, { maxTokens: 100, temperature: 0 });
      expect(result.content).toBeTruthy();
      console.log('[cache-messages-extended]:', result.content?.slice(0, 80));
    }, 60_000);

    it('should work with streamQuery', async () => {
      const ctx = createContext(chatModule);
      ctx.userMessage = 'What is a union type in one sentence?';
      const { stream, result } = await driver.streamQuery(
        compile(chatModule, ctx),
        { maxTokens: 100, temperature: 0 },
      );

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const queryResult = await result;
      expect(chunks.length).toBeGreaterThan(0);
      expect(queryResult.content).toBeTruthy();
      console.log('[cache-messages-stream]:', queryResult.content?.slice(0, 80));
    }, 60_000);
  });

  // ================================================================
  // テストケース群2: State-aware caching
  //
  // STANDARD_SECTIONSの配置順: state → inputs → materials → chunks → messages
  // state (title: 'Current State') は extractCacheablePrefix で非キャッシュと判定
  // されるため、data 内の cacheable prefix は state で遮断される。
  //
  // stateなしの場合は materials が cacheable prefix に含まれる。
  // ================================================================
  describe('State-aware caching', () => {
    const docModule: PromptModule<DocContext> = {
      createContext: () => ({ stateInfo: '', userMessage: '' }),
      instructions: [
        'You are a documentation assistant. Answer questions based on the provided reference materials. Respond concisely.',
      ],
      materials: [
        { type: 'material', id: 'doc1', title: 'API Reference',
          content: 'The createUser function accepts a name (string) and age (number). It returns a User object with an auto-generated id.' },
        { type: 'material', id: 'doc2', title: 'Best Practices',
          content: 'Always validate input parameters before calling createUser. Use TypeScript strict mode for better type safety.' },
      ],
      state: [(ctx) => ctx.stateInfo],
      messages: [
        (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.userMessage }),
      ],
    };

    it('should block data prefix at state section while queries still work', async () => {
      const ctx1 = createContext(docModule);
      ctx1.stateInfo = 'User is reading the API reference';
      ctx1.userMessage = 'What parameters does createUser accept?';
      const compiled1 = compile(docModule, ctx1);

      // state が data 先頭に来るため、data の cacheable prefix は空
      const prefix = extractCacheablePrefix(compiled1);
      expect(prefix.instructions.length).toBeGreaterThan(0);
      expect(prefix.data.length).toBe(0);

      // stateがprefixを遮断するため、キャッシュはinstructionsのみ
      const handle = await cacheController.prepare({
        model,
        instructions: prefix.instructions,
        data: prefix.data,
      });
      expect(handle.includes.instructions).toBe(true);
      expect(handle.includes.dataElementCount).toBe(0);

      const result1 = await driver.query(compiled1, { maxTokens: 100, temperature: 0 });
      expect(result1.content).toBeTruthy();

      const ctx2 = createContext(docModule);
      ctx2.stateInfo = 'User is reading best practices';
      ctx2.userMessage = 'What should I do before calling createUser?';
      const result2 = await driver.query(compile(docModule, ctx2), { maxTokens: 100, temperature: 0 });
      expect(result2.content).toBeTruthy();

      console.log('[cache-state] result1:', result1.content?.slice(0, 80));
      console.log('[cache-state] result2:', result2.content?.slice(0, 80));
    }, 60_000);

    it('should include materials in cacheable prefix when state is absent', async () => {
      const noStateModule: PromptModule<DocContext> = {
        createContext: () => ({ stateInfo: '', userMessage: '' }),
        instructions: [
          'You are a documentation assistant. Answer questions based on the provided reference materials. Respond concisely.',
        ],
        materials: [
          { type: 'material', id: 'doc1', title: 'API Reference',
            content: 'The createUser function accepts a name (string) and age (number). It returns a User object with an auto-generated id.' },
          { type: 'material', id: 'doc2', title: 'Best Practices',
            content: 'Always validate input parameters before calling createUser. Use TypeScript strict mode for better type safety.' },
        ],
        messages: [
          (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.userMessage }),
        ],
      };

      const ctx = createContext(noStateModule);
      ctx.userMessage = 'Summarize the API reference.';
      const compiled = compile(noStateModule, ctx);

      // stateなし → materials が cacheable prefix に入る
      const prefix = extractCacheablePrefix(compiled);
      expect(prefix.instructions.length).toBeGreaterThan(0);
      expect(prefix.data.length).toBe(4); // Prepared Materials SectionElement + 2 MaterialElements + Messages SectionElement

      const result = await driver.query(compiled, { maxTokens: 100, temperature: 0 });
      expect(result.content).toBeTruthy();
      console.log('[cache-no-state]:', result.content?.slice(0, 80));
    }, 60_000);

    it('should break cacheable prefix when guidelines have dynamic content', async () => {
      // DynamicContent由来のguidelinesセクションは cacheHint: 'contextual' になり、
      // instructions 内の cacheable prefix を遮断する
      const dynamicGuidelinesModule: PromptModule<DocContext> = {
        createContext: () => ({ stateInfo: '', userMessage: '' }),
        instructions: ['You are a helpful assistant.'],
        guidelines: [
          () => 'Current session context: user is testing.',
        ],
        materials: [
          { type: 'material', id: 'doc1', title: 'API Reference',
            content: 'The createUser function accepts a name (string) and age (number).' },
        ],
        messages: [
          (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.userMessage }),
        ],
      };

      const ctx = createContext(dynamicGuidelinesModule);
      ctx.userMessage = 'What is createUser?';
      const compiled = compile(dynamicGuidelinesModule, ctx);

      // guidelines が contextual → instructions prefix が途切れる → data は prefix に入らない
      const prefix = extractCacheablePrefix(compiled);
      expect(prefix.instructions.length).toBe(1); // Instructions section のみ
      expect(prefix.data.length).toBe(0);

      const result = await driver.query(compiled, { maxTokens: 100, temperature: 0 });
      expect(result.content).toBeTruthy();
      console.log('[cache-dynamic-guidelines]:', result.content?.slice(0, 80));
    }, 60_000);
  });
});
