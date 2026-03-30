/**
 * MLX Driver パラメータシステムテスト
 *
 * 実際のMLXプロセスとモデルを使用して、
 * パラメータ（特にtemperature）が正しく処理されることを確認
 *
 * テストレベル: システムテスト
 * 実行時間: 各テスト10-30秒（モデルロード含む）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MlxDriver } from '../../src/mlx-ml/mlx-driver.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import { platform } from 'os';

// MLXはApple Silicon専用なので、他のプラットフォームではスキップ
const isMacOS = platform() === 'darwin';

/**
 * ユーザーメッセージを含むCompiledPromptを生成するヘルパー
 */
function chatPrompt(content: string): CompiledPrompt {
  return {
    instructions: [],
    data: [{ type: 'message', role: 'user', content }],
    output: [],
  };
}

describe.skipIf(!isMacOS)('MLX Parameters System Test', () => {
  let driver: MlxDriver;
  const testModel = 'mlx-community/gemma-3-270m-it-qat-8bit';

  beforeAll(async () => {
    console.log(`\n🔧 Setting up MLX system test with model: ${testModel}`);
    console.log('⏳ This may take 10-30 seconds for initial model download...\n');

    // 実際のMLXドライバーを初期化
    driver = new MlxDriver({ model: testModel });

    // 初回のクエリでモデルをロード（ウォームアップ）
    try {
      await driver.query(chatPrompt('test'), { maxTokens: 1 });
      console.log('✅ Model loaded successfully\n');
    } catch (error) {
      console.error('❌ Failed to load model:', error);
      throw error;
    }
  }, 60000); // 60秒のタイムアウト（初回のモデルダウンロード用）

  afterAll(async () => {
    console.log('\n🧹 Cleaning up MLX system test...');
    if (driver) {
      await driver.close();
    }
  });

  describe('Temperature Parameter Processing', () => {
    it('should accept temperature=0 (deterministic mode) without error', async () => {
      const prompt = chatPrompt('1+1=');

      // temperature=0で決定的な出力を要求
      // エラーが発生しないことを確認
      const result = await driver.query(prompt, {
        maxTokens: 5,
        temperature: 0
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(typeof result.content).toBe('string');

      // 決定的モードなので、複数回実行しても同じ結果になるはず
      const result2 = await driver.query(prompt, {
        maxTokens: 5,
        temperature: 0
      });

      expect(result2.content).toBe(result.content);
      console.log(`✓ Deterministic output (temp=0): "${result.content.trim()}"`);
    }, 30000);

    it('should accept temperature=0.5 (moderate randomness) without error', async () => {
      // temperature=0.5で適度なランダム性
      const result = await driver.query(chatPrompt('Hello'), {
        maxTokens: 10,
        temperature: 0.5
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      console.log(`✓ Moderate randomness (temp=0.5): "${result.content.trim()}"`);
    }, 30000);

    it('should accept temperature=1.0 (high randomness) without error', async () => {
      // temperature=1.0で高いランダム性
      const result = await driver.query(chatPrompt('Write a word:'), {
        maxTokens: 5,
        temperature: 1.0
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      console.log(`✓ High randomness (temp=1.0): "${result.content.trim()}"`);
    }, 30000);

    it('should handle temperature parameter with other parameters', async () => {
      // 複数のパラメータを同時に指定
      const result = await driver.query(chatPrompt('Count to three:'), {
        maxTokens: 20,
        temperature: 0.3,
        topP: 0.9,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      console.log(`✓ Multiple parameters: "${result.content.trim()}"`);
    }, 30000);
  });

  describe('Parameter Validation and Mapping', () => {
    it('should handle out-of-range temperature values', async () => {
      // 範囲外の値は自動的にクランプされるはず
      const result = await driver.query(chatPrompt('test'), {
        maxTokens: 1,
        temperature: -1 // 0にクランプされるはず
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      console.log('✓ Handled negative temperature');
    }, 30000);

    it('should process camelCase parameters correctly', async () => {
      // すべてのパラメータをcamelCaseで指定
      const result = await driver.query(chatPrompt('test'), {
        maxTokens: 5,
        temperature: 0.5,
        topP: 0.9,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      console.log('✓ All camelCase parameters processed correctly');
    }, 30000);
  });

  describe('Completion API with Temperature', () => {
    it('should handle temperature in completion API', async () => {
      // シンプルなテキストプロンプトを使用（MessageElementなし）
      // これによりcompletion APIが自動選択される
      const compiledPrompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'Complete this sentence:' }],
        data: [{ type: 'text', content: 'The sky is' }],
        output: []
      };

      const result = await driver.query(compiledPrompt, {
        maxTokens: 5,
        temperature: 0.4
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      console.log(`✓ Completion API with temp=0.4: "${result.content.trim()}"`);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should not throw "unexpected keyword argument temp" error', async () => {
      // この呼び出しで "unexpected keyword argument 'temp'" エラーが
      // 発生しないことを確認（修正前はこのエラーが発生していた）
      let error: Error | null = null;
      try {
        await driver.query(chatPrompt('test'), {
          maxTokens: 1,
          temperature: 0.5
        });
      } catch (e) {
        error = e as Error;
      }

      // エラーが発生しないか、発生しても"temp"関連でないことを確認
      if (error) {
        expect(error.message).not.toContain('unexpected keyword argument');
        expect(error.message).not.toContain('temp');
      } else {
        expect(error).toBeNull();
      }
      console.log('✓ No "unexpected keyword argument temp" error');
    }, 30000);
  });
});
