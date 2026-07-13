/**
 * MLX Driver パラメータ統合テスト
 * 
 * 実際のMLXプロセスとの通信をテストして、
 * temperatureなどのパラメータが正しく処理されることを確認
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MlxDriver } from './mlx-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import { platform } from 'os';
import { DEFAULT_MLX_TEST_MODEL } from '../../test/integration/test-config.js';

// MLXはApple Silicon専用なので、CI環境や非対応環境ではスキップ
const shouldSkipMLX =
  platform() !== 'darwin' ||
  process.env.CI === 'true' ||
  process.env.SKIP_MLX_TESTS === 'true';

describe.skipIf(shouldSkipMLX)('MLX Driver Parameters Integration', () => {
  let driver: MlxDriver | null = null;

  beforeAll(async () => {
    // ダウンロード済みのモデルを使用
    driver = new MlxDriver({
      model: DEFAULT_MLX_TEST_MODEL,
    });
  });

  afterAll(async () => {
    if (driver) {
      await driver.close();
    }
  });

  it('should work without any parameters', async () => {
    if (!driver) {
      throw new Error('Driver not initialized');
    }

    const compiledPrompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: 'Say: TEST'
        }
      ],
      output: []
    };

    // パラメータなしで実行
    const result = await driver.query(compiledPrompt);

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
  }, 60000); // 60秒のタイムアウト

  it('should accept temperature parameter without error', async () => {
    if (!driver) {
      throw new Error('Driver not initialized');
    }

    // MessageElementsを含むCompiledPromptを作成
    const compiledPrompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: 'Say exactly: TEST'
        }
      ],
      output: []
    };

    // temperatureパラメータを渡してエラーが出ないことを確認
    const result = await driver.query(compiledPrompt, {
      maxTokens: 5,
      temperature: 0.1  // 低い温度で決定的な出力に近づける
    });

    // エラーなく結果が返ることを確認
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
  }, 60000); // 60秒のタイムアウト

  it('should accept multiple parameters without error', async () => {
    if (!driver) {
      throw new Error('Driver not initialized');
    }

    const compiledPrompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: 'Hi'
        }
      ],
      output: []
    };

    // 複数のパラメータを同時に渡す
    const result = await driver.query(compiledPrompt, {
      maxTokens: 10,
      temperature: 0.5,
      topP: 0.9
    });

    // エラーなく結果が返ることを確認
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  }, 60000); // 60秒のタイムアウト

  it('should work with completion API and temperature', async () => {
    if (!driver) {
      throw new Error('Driver not initialized');
    }

    // シンプルなテキストプロンプトを使用（MessageElementなし）
    // これによりcompletion APIが自動選択される
    const compiledPrompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'Complete this:' }],
      data: [{ type: 'text', content: 'Hello' }],
      output: []
    };

    const result = await driver.query(compiledPrompt, {
      maxTokens: 5,
      temperature: 0.3
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  }, 60000); // 60秒のタイムアウト

  it('should handle temperature=0 (deterministic)', async () => {
    if (!driver) {
      throw new Error('Driver not initialized');
    }

    const compiledPrompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: '1+1='
        }
      ],
      output: []
    };

    // temperature=0で決定的な出力
    const result = await driver.query(compiledPrompt, {
      maxTokens: 3,
      temperature: 0
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  }, 60000); // 60秒のタイムアウト
});
