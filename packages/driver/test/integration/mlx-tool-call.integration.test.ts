/**
 * MLX Driver Tool Call 統合テスト
 *
 * 実際のMLXモデルを使用して、tool call機能が正しく動作することを検証する。
 * - nativeModel: chat_templateでtool call形式をサポートするモデル
 * - fallbackModel: テキスト注入方式でtool callを実現するモデル
 *
 * test-drivers.yaml に mlx セクションの設定がない場合はスキップされる。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MlxDriver } from '../../src/mlx-ml/mlx-driver.js';
import { hasDriverConfig, getDriverConfig } from './test-config.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ToolDefinition } from '../../src/types.js';
import { platform } from 'os';

const isMacOS = platform() === 'darwin';

function chatPrompt(content: string): CompiledPrompt {
  return {
    instructions: [],
    data: [{ type: 'message', role: 'user', content }],
    output: [],
  };
}

const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: '指定された都市の現在の天気情報を取得して返す。都市名を受け取り、気温・天候などの情報を返す。',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name (e.g. "Tokyo", "New York")' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature unit' },
      },
      required: ['location'],
    },
  },
];

const toolCallPrompt = chatPrompt(
  'What is the weather in Tokyo? Use the get_weather tool to find out.'
);

/**
 * tool callの基本検証を実行する共通テストスイート
 */
function defineToolCallTests(getDriver: () => MlxDriver, label: string) {
  it(`[${label}] should return a tool call with correct function name`, async () => {
    const result = await getDriver().query(toolCallPrompt, {
      tools,
      toolChoice: 'required',
      maxTokens: 2000,
      temperature: 0,
    });

    console.log(`[${label}] query result:`, JSON.stringify({
      content: result.content,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
    }, null, 2));

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1);
    expect(result.toolCalls![0].name).toBe('get_weather');
  }, 60000);

  it(`[${label}] should return tool call with correct arguments`, async () => {
    const result = await getDriver().query(toolCallPrompt, {
      tools,
      toolChoice: 'required',
      maxTokens: 2000,
      temperature: 0,
    });

    expect(result.toolCalls).toBeDefined();
    const args = result.toolCalls![0].arguments;
    expect(args).toBeDefined();
    // location引数に「Tokyo」または「東京」が含まれるか
    const location = typeof args === 'object' ? (args as Record<string, unknown>).location : undefined;
    expect(location).toBeDefined();
    expect(typeof location).toBe('string');
    expect((location as string).toLowerCase()).toMatch(/tokyo|東京/);

    console.log(`[${label}] tool call arguments:`, JSON.stringify(args));
  }, 60000);

  it(`[${label}] should return finishReason as tool_calls`, async () => {
    const result = await getDriver().query(toolCallPrompt, {
      tools,
      toolChoice: 'required',
      maxTokens: 2000,
      temperature: 0,
    });

    expect(result.finishReason).toBe('tool_calls');
  }, 60000);

  it(`[${label}] should handle tool call in streamQuery`, async () => {
    const { stream, result } = await getDriver().streamQuery(toolCallPrompt, {
      tools,
      toolChoice: 'required',
      maxTokens: 2000,
      temperature: 0,
    });

    // ストリームを消費
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const queryResult = await result;

    console.log(`[${label}] stream result (${chunks.length} chunks):`, JSON.stringify({
      content: queryResult.content,
      toolCalls: queryResult.toolCalls,
      finishReason: queryResult.finishReason,
    }, null, 2));

    expect(queryResult.toolCalls).toBeDefined();
    expect(queryResult.toolCalls!.length).toBeGreaterThanOrEqual(1);
    expect(queryResult.toolCalls![0].name).toBe('get_weather');
  }, 60000);
}

describe.skipIf(!isMacOS || !hasDriverConfig('mlx'))('MLX Tool Call Integration', () => {
  const mlxConfig = getDriverConfig('mlx');

  describe.skipIf(!mlxConfig?.nativeModel)('Native Tool Support Model', () => {
    let driver: MlxDriver;

    beforeAll(async () => {
      const model = mlxConfig!.nativeModel!;
      console.log(`\n🔧 Setting up native tool call test with model: ${model}`);
      driver = new MlxDriver({ model });

      // ウォームアップ
      try {
        await driver.query(chatPrompt('test'), { maxTokens: 1 });
        console.log('✅ Native model loaded successfully\n');
      } catch (error) {
        console.error('❌ Failed to load native model:', error);
        throw error;
      }
    }, 120000);

    afterAll(async () => {
      if (driver) {
        await driver.close();
      }
    });

    defineToolCallTests(() => driver, 'native');
  });

  describe.skipIf(!mlxConfig?.fallbackModel)('Text-based Tool Support Model', () => {
    let driver: MlxDriver;

    beforeAll(async () => {
      const model = mlxConfig!.fallbackModel!;
      console.log(`\n🔧 Setting up fallback tool call test with model: ${model}`);
      driver = new MlxDriver({ model });

      // ウォームアップ
      try {
        await driver.query(chatPrompt('test'), { maxTokens: 1 });
        const caps = await driver.getCapabilities();
        console.log('✅ Fallback model loaded successfully');
        console.log('📋 capabilities:', JSON.stringify({
          specialTokens: caps.specialTokens ? Object.keys(caps.specialTokens) : [],
          toolCallFormat: caps.features?.chatTemplate?.toolCallFormat,
          hasChatTemplate: caps.features?.hasChatTemplate,
        }, null, 2));
      } catch (error) {
        console.error('❌ Failed to load fallback model:', error);
        throw error;
      }
    }, 120000);

    afterAll(async () => {
      if (driver) {
        await driver.close();
      }
    });

    defineToolCallTests(() => driver, 'fallback');
  });
});
