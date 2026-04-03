import { describe, it, expect, vi } from 'vitest';
import { toolAgentProcess } from './tool-agent-workflow.js';
import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver, QueryResult } from '@modular-prompt/driver';
import type { ToolSpec, ToolAgentContext } from './types.js';

interface TestContext extends ToolAgentContext {
  data?: string;
}

function createMockDriver(responses: Partial<QueryResult>[]): AIDriver {
  const queryFn = vi.fn();
  for (const res of responses) {
    queryFn.mockResolvedValueOnce({
      content: '',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      ...res,
    });
  }
  return {
    query: queryFn,
    streamQuery: vi.fn(),
    close: vi.fn(),
  };
}

describe('toolAgentProcess', () => {
  const simpleModule: PromptModule<TestContext> = {
    objective: ['Test agent'],
  };

  it('should return on first turn when no tool calls', async () => {
    const driver = createMockDriver([
      { content: 'done' },
    ]);

    const result = await toolAgentProcess(driver, simpleModule, {});

    expect(result.output).toBe('done');
    expect(result.metadata?.iterations).toBe(1);
    expect(driver.query).toHaveBeenCalledTimes(1);
  });

  it('should execute tool calls and feed results back', async () => {
    const driver = createMockDriver([
      {
        content: 'calling tool',
        toolCalls: [{ id: 'tc1', name: 'greet', arguments: { name: 'world' } }],
      },
      { content: 'final answer' },
    ]);

    const greetTool: ToolSpec<TestContext> = {
      definition: { name: 'greet', description: 'Greet', parameters: { type: 'object', properties: {} } },
      handler: async (args) => `Hello, ${args.name}!`,
    };

    const context: TestContext = {};
    const result = await toolAgentProcess(driver, simpleModule, context, {
      tools: [greetTool],
    });

    expect(result.output).toBe('final answer');
    expect(result.metadata?.iterations).toBe(2);
    expect(result.metadata?.toolCallLog).toHaveLength(1);
    expect(result.metadata?.toolCallLog[0].result).toBe('Hello, world!');
  });

  it('should pass context to tool handler', async () => {
    const driver = createMockDriver([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'read_data', arguments: {} }],
      },
      { content: 'done' },
    ]);

    const readDataTool: ToolSpec<TestContext> = {
      definition: { name: 'read_data', description: 'Read', parameters: { type: 'object', properties: {} } },
      handler: async (_args, ctx) => `data is: ${ctx.data}`,
    };

    const context: TestContext = { data: 'hello' };
    const result = await toolAgentProcess(driver, simpleModule, context, {
      tools: [readDataTool],
    });

    expect(result.metadata?.toolCallLog[0].result).toBe('data is: hello');
  });

  it('should allow tool handler to modify context', async () => {
    const driver = createMockDriver([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'set_data', arguments: { value: 'modified' } }],
      },
      { content: 'done' },
    ]);

    const setDataTool: ToolSpec<TestContext> = {
      definition: { name: 'set_data', description: 'Set', parameters: { type: 'object', properties: {} } },
      handler: async (args, ctx) => {
        ctx.data = args.value as string;
        return 'ok';
      },
    };

    const context: TestContext = { data: 'original' };
    await toolAgentProcess(driver, simpleModule, context, {
      tools: [setDataTool],
    });

    expect(context.data).toBe('modified');
  });

  it('should accumulate messages in context.messages', async () => {
    const driver = createMockDriver([
      {
        content: 'thinking...',
        toolCalls: [{ id: 'tc1', name: 'noop', arguments: {} }],
      },
      { content: 'done' },
    ]);

    const noopTool: ToolSpec<TestContext> = {
      definition: { name: 'noop', description: 'No-op', parameters: { type: 'object', properties: {} } },
      handler: async () => 'ok',
    };

    const context: TestContext = {};
    await toolAgentProcess(driver, simpleModule, context, {
      tools: [noopTool],
    });

    // assistant message + tool result from the first turn
    expect(context.messages).toHaveLength(2);
    expect(context.messages![0]).toMatchObject({ role: 'assistant', content: 'thinking...' });
    expect(context.messages![1]).toMatchObject({ role: 'tool', name: 'noop' });
  });

  it('should re-compile each turn reflecting context changes', async () => {
    // Module with DynamicContent that reads context.data
    const dynamicModule: PromptModule<TestContext> = {
      objective: ['Test agent'],
      state: [(ctx) => ctx.data ? `Current data: ${ctx.data}` : null],
    };

    const driver = createMockDriver([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'set_data', arguments: { value: 'updated' } }],
      },
      { content: 'done' },
    ]);

    const setDataTool: ToolSpec<TestContext> = {
      definition: { name: 'set_data', description: 'Set', parameters: { type: 'object', properties: {} } },
      handler: async (args, ctx) => {
        ctx.data = args.value as string;
        return 'ok';
      },
    };

    const context: TestContext = { data: 'initial' };
    await toolAgentProcess(driver, dynamicModule, context, {
      tools: [setDataTool],
    });

    // Verify that the second query received a re-compiled prompt
    // with the updated context (data = 'updated')
    const secondCallPrompt = (driver.query as any).mock.calls[1][0];
    // The state section should contain 'updated' from the re-compiled DynamicContent
    const stateContent = JSON.stringify(secondCallPrompt.data);
    expect(stateContent).toContain('updated');
    expect(stateContent).not.toContain('initial');
  });

  it('should aggregate usage across turns', async () => {
    const driver = createMockDriver([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'noop', arguments: {} }],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
      {
        content: 'done',
        usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
      },
    ]);

    const noopTool: ToolSpec = {
      definition: { name: 'noop', description: 'No-op', parameters: { type: 'object', properties: {} } },
      handler: async () => 'ok',
    };

    const result = await toolAgentProcess(driver, simpleModule, {}, {
      tools: [noopTool],
    });

    expect(result.consumedUsage).toEqual({
      promptTokens: 300,
      completionTokens: 130,
      totalTokens: 430,
    });
    expect(result.responseUsage).toEqual({
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
    });
  });

  it('should handle unknown tool gracefully', async () => {
    const driver = createMockDriver([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'nonexistent', arguments: {} }],
      },
      { content: 'recovered' },
    ]);

    const result = await toolAgentProcess(driver, simpleModule, {});

    expect(result.output).toBe('recovered');
    expect(result.metadata?.toolCallLog[0].result).toContain('Error');
  });

  it('should stop at maxTurns', async () => {
    const driver = createMockDriver([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'noop', arguments: {} }],
      },
      {
        content: '',
        toolCalls: [{ id: 'tc2', name: 'noop', arguments: {} }],
      },
    ]);

    const noopTool: ToolSpec = {
      definition: { name: 'noop', description: 'No-op', parameters: { type: 'object', properties: {} } },
      handler: async () => 'ok',
    };

    const result = await toolAgentProcess(driver, simpleModule, {}, {
      tools: [noopTool],
      maxTurns: 2,
    });

    expect(result.output).toBe('');
    expect(result.metadata?.iterations).toBe(2);
  });
});
