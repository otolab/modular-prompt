/**
 * E2E tests for AI chat functionality
 * TestDriver と EchoDriver を使ってプロンプト生成を確認
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { performAIChat } from './ai-chat.js';
import type { DialogProfile, ChatLog } from './types.js';
import { DriverRegistry, TestDriver, EchoDriver } from '@modular-prompt/driver';
import type { CompiledPrompt } from '@modular-prompt/core';

describe('AI Chat E2E Tests', () => {
  let registry: DriverRegistry;
  
  beforeEach(() => {
    registry = new DriverRegistry();
    // コンソール出力をモック
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('TestDriver - レスポンス確認', () => {
    it('基本的なチャット対話を処理できる', async () => {
      // TestDriverを登録
      registry.registerFactory('test' as any, () => {
        return new TestDriver({
          responses: ['こんにちは！今日はいい天気ですね。どのようなお手伝いができますか？']
        });
      });
      
      registry.registerModel({
        model: 'test-chat',
        provider: 'test' as any,
        capabilities: ['chat', 'japanese']
      });
      
      const profile: DialogProfile = {
        model: 'test-chat',
        systemPrompt: 'チャットアシスタントとして、ユーザーとの対話を行う'
      };
      
      const chatLog: ChatLog = {
        sessionId: 'test-session',
        startedAt: new Date().toISOString(),
        messages: [],
        profile
      };
      
      const result = await performAIChat(
        profile,
        chatLog,
        'こんにちは、今日はいい天気ですね。',
        undefined,
        registry
      );
      
      expect(result.response).toBe('こんにちは！今日はいい天気ですね。どのようなお手伝いができますか？');
      await result.driver.close?.();
    });
    
    it('会話履歴を含むプロンプトを処理できる', async () => {
      let capturedPrompt: CompiledPrompt | null = null;
      
      // プロンプトをキャプチャするTestDriver
      registry.registerFactory('test' as any, () => {
        return new TestDriver({
          responses: (prompt: CompiledPrompt) => {
            capturedPrompt = prompt;
            return 'はい、TypeScriptはJavaScriptに型システムを追加した言語です。';
          }
        });
      });
      
      registry.registerModel({
        model: 'test-chat',
        provider: 'test' as any,
        capabilities: ['chat']
      });
      
      const profile: DialogProfile = {
        model: 'test-chat',
        systemPrompt: 'チャットアシスタントとして、ユーザーとの対話を行う'
      };
      
      const chatLog: ChatLog = {
        sessionId: 'test-session',
        startedAt: new Date().toISOString(),
        messages: [
          { role: 'user', content: 'プログラミングについて教えて', timestamp: new Date().toISOString() },
          { role: 'assistant', content: 'プログラミングについて何をお知りになりたいですか？', timestamp: new Date().toISOString() }
        ],
        profile
      };
      
      const result = await performAIChat(
        profile,
        chatLog,
        'TypeScriptとは何ですか？',
        undefined,
        registry
      );
      
      // プロンプトの構造を確認
      expect(capturedPrompt).not.toBeNull();
      expect(capturedPrompt!.instructions).toBeDefined();
      expect(capturedPrompt!.data).toBeDefined();
      
      // 会話履歴が含まれているか確認
      const dataContent = JSON.stringify(capturedPrompt!.data);
      expect(dataContent).toContain('プログラミングについて教えて');
      
      // 現在のユーザメッセージはoutputセクションに含まれる
      const outputContent = JSON.stringify(capturedPrompt!.output);
      expect(outputContent).toContain('TypeScriptとは何ですか？');
      
      await result.driver.close?.();
    });
  });
  
  describe('EchoDriver - プロンプト生成確認', () => {
    it('テキスト形式のプロンプトを生成する', async () => {
      // EchoDriverを登録（text形式）
      registry.registerFactory('echo' as any, () => {
        return new EchoDriver({
          format: 'text',
          includeMetadata: false
        });
      });
      
      registry.registerModel({
        model: 'echo-text',
        provider: 'echo' as any,
        capabilities: ['chat']
      });
      
      const profile: DialogProfile = {
        model: 'echo-text',
        systemPrompt: 'チャットアシスタントとして、ユーザーとの対話を行う'
      };
      
      const chatLog: ChatLog = {
        sessionId: 'test-session',
        startedAt: new Date().toISOString(),
        messages: [],
        profile
      };
      
      const result = await performAIChat(
        profile,
        chatLog,
        'テストメッセージです',
        undefined,
        registry
      );
      
      // EchoDriverはプロンプトをそのまま返すので、プロンプト構造を確認できる
      expect(result.response).toContain('チャットアシスタント');
      expect(result.response).toContain('日本語で応答');
      expect(result.response).toContain('テストメッセージです');
      
      await result.driver.close?.();
    });
    
    it('メッセージ形式のプロンプトを生成する', async () => {
      // EchoDriverを登録（messages形式）
      registry.registerFactory('echo' as any, () => {
        return new EchoDriver({
          format: 'messages',
          includeMetadata: false
        });
      });
      
      registry.registerModel({
        model: 'echo-messages',
        provider: 'echo' as any,
        capabilities: ['chat']
      });
      
      const profile: DialogProfile = {
        model: 'echo-messages',
        systemPrompt: 'チャットアシスタントとして、ユーザーとの対話を行う'
      };
      
      const chatLog: ChatLog = {
        sessionId: 'test-session',
        startedAt: new Date().toISOString(),
        messages: [],
        profile
      };
      
      const result = await performAIChat(
        profile,
        chatLog,
        'こんにちは',
        undefined,
        registry
      );
      
      // メッセージ形式のJSONが返される
      const messages = JSON.parse(result.response);
      expect(Array.isArray(messages)).toBe(true);
      
      // システムメッセージが含まれる（複数のシステムメッセージがあるので、最初のものを確認）
      const systemMessages = messages.filter((m: any) => m.role === 'system');
      expect(systemMessages.length).toBeGreaterThan(0);
      const allSystemContent = systemMessages.map((m: any) => m.content).join(' ');
      expect(allSystemContent).toContain('チャットアシスタント');
      
      // 最後のシステムメッセージにユーザーメッセージが含まれる
      // （formatPromptAsMessagesの実装では全てがsystemロールになる）
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage).toBeDefined();
      expect(lastMessage.content).toContain('こんにちは');
      
      await result.driver.close?.();
    });
    
    it('デバッグ形式で詳細なプロンプト情報を生成する', async () => {
      // EchoDriverを登録（debug形式）
      registry.registerFactory('echo' as any, () => {
        return new EchoDriver({
          format: 'debug',
          includeMetadata: false
        });
      });
      
      registry.registerModel({
        model: 'echo-debug',
        provider: 'echo' as any,
        capabilities: ['chat']
      });
      
      const profile: DialogProfile = {
        model: 'echo-debug',
        systemPrompt: 'あなたは親切なアシスタントです。'
      };
      
      const chatLog: ChatLog = {
        sessionId: 'test-session',
        startedAt: new Date().toISOString(),
        messages: [
          { role: 'user', content: '天気はどう？', timestamp: new Date().toISOString() },
          { role: 'assistant', content: '今日は晴れていますね。', timestamp: new Date().toISOString() }
        ],
        profile
      };
      
      const result = await performAIChat(
        profile,
        chatLog,
        '散歩に行きたい',
        undefined,
        registry
      );
      
      // デバッグ形式のJSONが返される
      const debug = JSON.parse(result.response);
      
      // 生のCompiledPrompt構造を確認
      expect(debug.raw).toBeDefined();
      expect(debug.raw.instructions).toBeDefined();
      expect(debug.raw.data).toBeDefined();
      expect(debug.raw.output).toBeDefined();
      
      // フォーマット済みテキストとメッセージを確認
      expect(debug.formatted).toBeDefined();
      expect(debug.formatted.text).toBeDefined();
      expect(debug.formatted.messages).toBeDefined();
      
      // メタデータを確認
      expect(debug.metadata).toBeDefined();
      expect(debug.metadata.instructionsCount).toBeGreaterThan(0);
      expect(debug.metadata.dataCount).toBeGreaterThan(0);
      
      // カスタムシステムプロンプトが反映されているか確認
      expect(debug.formatted.text).toContain('あなたは親切なアシスタントです');
      
      // 会話履歴が含まれているか確認
      expect(debug.formatted.text).toContain('天気はどう？');
      expect(debug.formatted.text).toContain('今日は晴れていますね');
      expect(debug.formatted.text).toContain('散歩に行きたい');
      
      await result.driver.close?.();
    });
  });
  
  describe('複雑なシナリオ', () => {
    it('長い会話履歴を含むプロンプトを処理できる', async () => {
      let capturedPrompt: CompiledPrompt | null = null;
      
      registry.registerFactory('test' as any, () => {
        return new TestDriver({
          responses: (prompt: CompiledPrompt) => {
            capturedPrompt = prompt;
            return 'お役に立てて嬉しいです！';
          }
        });
      });
      
      registry.registerModel({
        model: 'test-chat',
        provider: 'test' as any,
        capabilities: ['chat']
      });
      
      const profile: DialogProfile = {
        model: 'test-chat',
        systemPrompt: 'あなたは技術サポートアシスタントです。',
        options: {
          temperature: 0.7,
          maxTokens: 1000
        }
      };
      
      const now = new Date().toISOString();
      const chatLog: ChatLog = {
        sessionId: 'test-session',
        startedAt: now,
        messages: [
          { role: 'user', content: 'Pythonについて教えて', timestamp: now },
          { role: 'assistant', content: 'Pythonは汎用プログラミング言語です。', timestamp: now },
          { role: 'user', content: 'どんな用途に使える？', timestamp: now },
          { role: 'assistant', content: 'Web開発、データ分析、機械学習など様々な用途に使えます。', timestamp: now },
          { role: 'user', content: '初心者におすすめ？', timestamp: now },
          { role: 'assistant', content: 'はい、構文がシンプルで学習しやすいです。', timestamp: now }
        ],
        profile
      };
      
      const result = await performAIChat(
        profile,
        chatLog,
        'ありがとう、とても参考になりました',
        undefined,
        registry
      );
      
      expect(result.response).toBe('お役に立てて嬉しいです！');
      
      // プロンプトに全ての会話履歴が含まれているか確認
      const dataContent = JSON.stringify(capturedPrompt!.data);
      expect(dataContent).toContain('Python');
      expect(dataContent).toContain('Web開発');
      expect(dataContent).toContain('初心者');
      
      // 現在のユーザメッセージはoutputセクションに含まれる
      const outputContent = JSON.stringify(capturedPrompt!.output);
      expect(outputContent).toContain('ありがとう');
      
      await result.driver.close?.();
    });
    
    it('両形式のプロンプトを比較できる', async () => {
      // Both形式のEchoDriverを登録
      registry.registerFactory('echo' as any, () => {
        return new EchoDriver({
          format: 'both',
          includeMetadata: false
        });
      });
      
      registry.registerModel({
        model: 'echo-both',
        provider: 'echo' as any,
        capabilities: ['chat']
      });
      
      const profile: DialogProfile = {
        model: 'echo-both',
        systemPrompt: 'チャットアシスタントとして、ユーザーとの対話を行う'
      };
      
      const now = new Date().toISOString();
      const chatLog: ChatLog = {
        sessionId: 'test-session',
        startedAt: now,
        messages: [
          { role: 'user', content: '前の質問', timestamp: now },
          { role: 'assistant', content: '前の回答', timestamp: now }
        ],
        profile
      };
      
      const result = await performAIChat(
        profile,
        chatLog,
        'テスト質問',
        undefined,
        registry
      );
      
      const both = JSON.parse(result.response);
      
      // テキスト形式とメッセージ形式の両方が含まれる
      expect(both.text).toBeDefined();
      expect(both.messages).toBeDefined();
      
      // 両形式に同じ内容が含まれている
      expect(both.text).toContain('テスト質問');
      expect(both.text).toContain('前の質問');
      
      const messagesContent = JSON.stringify(both.messages);
      expect(messagesContent).toContain('テスト質問');
      expect(messagesContent).toContain('前の質問');
      
      await result.driver.close?.();
    });
  });
});