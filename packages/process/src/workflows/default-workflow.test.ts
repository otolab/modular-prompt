import { describe, it, expect, vi } from 'vitest';
import { defaultProcess } from './default-workflow.js';
import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver, QueryResult } from '@modular-prompt/driver';

// テスト用モックドライバー
function createMockDriver(result: Partial<QueryResult> = {}): AIDriver {
  return {
    query: vi.fn().mockResolvedValue({
      content: 'test response',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: 'stop',
      ...result,
    }),
    streamQuery: vi.fn(),
    close: vi.fn(),
  };
}

describe('defaultProcess', () => {
  it('should compile module and query driver', async () => {
    const driver = createMockDriver();
    const module: PromptModule<{ question: string }> = {
      objective: ['Answer the question'],
      messages: [
        (ctx) => ({ type: 'message' as const, role: 'user' as const, content: ctx.question }),
      ],
    };
    const context = { question: 'Hello' };

    const result = await defaultProcess(driver, module, context);

    expect(result.output).toBe('test response');
    expect(result.context).toBe(context);
    expect(result.metadata?.iterations).toBe(1);
    expect(result.metadata?.tokensUsed).toBe(30);
    expect(driver.query).toHaveBeenCalledTimes(1);
  });

  it('should pass queryOptions to driver', async () => {
    const driver = createMockDriver();
    const module: PromptModule<any> = {
      objective: ['Test'],
    };

    await defaultProcess(driver, module, {}, {
      queryOptions: { temperature: 0.3, maxTokens: 512 },
    });

    expect(driver.query).toHaveBeenCalledWith(
      expect.anything(),
      { temperature: 0.3, maxTokens: 512 }
    );
  });

  it('should include toolCalls in metadata when present', async () => {
    const toolCalls = [{ id: '1', name: 'get_weather', arguments: { location: 'Tokyo' } }];
    const driver = createMockDriver({
      toolCalls,
      finishReason: 'tool_calls',
    });
    const module: PromptModule<any> = { objective: ['Test'] };

    const result = await defaultProcess(driver, module, {});

    expect(result.metadata?.toolCalls).toEqual(toolCalls);
    expect(result.metadata?.finishReason).toBe('tool_calls');
  });

  it('should throw WorkflowExecutionError on failure', async () => {
    const driver: AIDriver = {
      query: vi.fn().mockRejectedValue(new Error('API error')),
      streamQuery: vi.fn(),
      close: vi.fn(),
    };
    const module: PromptModule<any> = { objective: ['Test'] };
    const context = { key: 'value' };

    await expect(defaultProcess(driver, module, context)).rejects.toThrow('API error');

    try {
      await defaultProcess(driver, module, context);
    } catch (error: any) {
      expect(error.name).toBe('WorkflowExecutionError');
      expect(error.context).toBe(context);
      expect(error.phase).toBe('query');
    }
  });
});
