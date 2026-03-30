/**
 * Anthropic Driver 統合テスト
 *
 * 実際のAnthropic APIに接続して基本機能を確認する。
 * test-drivers.yaml に anthropic の設定がない場合はスキップされる。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AnthropicDriver } from '../../src/anthropic/anthropic-driver.js';
import { hasDriverConfig, getDriverConfig } from './test-config.js';
import type { CompiledPrompt } from '@modular-prompt/core';

function chatPrompt(content: string): CompiledPrompt {
  return {
    instructions: [],
    data: [{ type: 'message', role: 'user', content }],
    output: [],
  };
}

describe.skipIf(!hasDriverConfig('anthropic'))('AnthropicDriver Integration', () => {
  let driver: AnthropicDriver;

  beforeAll(() => {
    const config = getDriverConfig('anthropic')!;
    driver = new AnthropicDriver({
      apiKey: config.apiKey,
      model: config.model,
      vertex: config.vertex,
    });
  });

  afterAll(async () => {
    if (driver) {
      await driver.close();
    }
  });

  it('should execute a basic query', async () => {
    const result = await driver.query(chatPrompt('Say exactly: HELLO'), {
      maxTokens: 20,
      temperature: 0,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    console.log(`query result: "${result.content.trim()}"`);
  }, 30000);

  it('should stream a response', async () => {
    const { stream, result } = await driver.streamQuery(chatPrompt('Count from 1 to 3.'), {
      maxTokens: 50,
      temperature: 0,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    const queryResult = await result;
    expect(queryResult.content).toBeDefined();
    expect(queryResult.content.length).toBeGreaterThan(0);
    console.log(`stream result (${chunks.length} chunks): "${queryResult.content.trim()}"`);
  }, 30000);

  it('should respect maxTokens', async () => {
    const result = await driver.query(chatPrompt('Write a very long essay about the ocean.'), {
      maxTokens: 10,
      temperature: 0,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    // maxTokens=10 なので出力は短いはず
    expect(result.finishReason).toBe('length');
    console.log(`maxTokens=10 result: "${result.content.trim()}"`);
  }, 30000);

  it('should return token usage', async () => {
    const result = await driver.query(chatPrompt('Hi'), {
      maxTokens: 10,
      temperature: 0,
    });

    expect(result.usage).toBeDefined();
    if (result.usage) {
      expect(result.usage.promptTokens).toBeGreaterThan(0);
      expect(result.usage.completionTokens).toBeGreaterThan(0);
      console.log(`usage: prompt=${result.usage.promptTokens}, completion=${result.usage.completionTokens}`);
    }
  }, 30000);
});
