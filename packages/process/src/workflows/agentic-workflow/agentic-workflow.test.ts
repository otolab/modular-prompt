import { describe, it, expect } from 'vitest';
import { agenticProcess } from './agentic-workflow.js';
import { TestDriver } from '@modular-prompt/driver';
import type { AgenticWorkflowContext, AgenticTaskPlan, ToolSpec } from './types.js';

describe('agenticProcess', () => {
  // 1. 基本ワークフロー
  it('should execute basic workflow with planning and execution', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning round 1: register tasks via __task tool
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Analyze input', taskType: 'think' } },
            { id: 'tc-2', name: '__task', arguments: { id: 'task-2', description: 'Generate output' } }
          ]
        },
        // Planning round 2: text output to finish planning
        'Plan complete.',
        // Execution task-1
        'Analysis complete',
        // Execution task-2
        'Output generated',
        // Integration
        'Final result'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Process data'
    };

    const userModule = {
      objective: ['Process data']
    };

    const result = await agenticProcess(driver, userModule, context);

    expect(result.output).toBe('Final result');
    expect(result.context.phase).toBe('complete');
    expect(result.context.executionLog).toHaveLength(2);
    expect(result.context.executionLog?.[0].taskId).toBe('task-1');
    expect(result.context.executionLog?.[0].result).toBe('Analysis complete');
    expect(result.context.executionLog?.[1].taskId).toBe('task-2');
    expect(result.context.executionLog?.[1].result).toBe('Output generated');
    expect(result.metadata?.planTasks).toBe(2);
    expect(result.metadata?.executedTasks).toBe(2);
  });

  // 2. 外部ツール呼び出し
  it('should handle external tool calls', async () => {
    let toolCalled = false;
    const tools: ToolSpec[] = [
      {
        definition: {
          name: 'getData',
          description: 'Get data by ID',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id']
          }
        },
        handler: async (args) => {
          toolCalled = true;
          expect(args.id).toBe('123');
          return { data: 'test data' };
        }
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Get data' } }] },
        'Done.',
        // Execution: call external tool
        { content: '', toolCalls: [{ id: 'call-1', name: 'getData', arguments: { id: '123' } }] },
        'Data processed',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Get and process data'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    expect(toolCalled).toBe(true);
    expect(result.context.executionLog?.[0].toolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[0].toolCalls?.[0].name).toBe('getData');
    expect(result.metadata?.toolCallsUsed).toBe(1);
  });

  // 3. 複数ラウンドのツール呼び出し
  it('should handle multiple rounds of tool calls', async () => {
    const tools: ToolSpec[] = [
      {
        definition: { name: 'search', description: 'Search data' },
        handler: async (args) => ({ results: [`found: ${args.query}`] })
      },
      {
        definition: { name: 'analyze', description: 'Analyze data' },
        handler: async (args) => ({ analysis: `analyzed: ${args.data}` })
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Search and analyze' } }] },
        'Done.',
        // Execution round 1: search
        { content: '', toolCalls: [{ id: 'c1', name: 'search', arguments: { query: 'test' } }] },
        // Execution round 2: analyze
        { content: '', toolCalls: [{ id: 'c2', name: 'analyze', arguments: { data: 'results' } }] },
        // Execution final: text output
        'Analysis complete',
        // Integration
        'Report'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Search and analyze'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    expect(result.context.executionLog?.[0].toolCalls).toHaveLength(2);
    expect(result.context.executionLog?.[0].toolCalls?.[0].name).toBe('search');
    expect(result.context.executionLog?.[0].toolCalls?.[1].name).toBe('analyze');
  });

  // 4. maxToolCalls制限
  it('should respect maxToolCalls limit', async () => {
    let callCount = 0;
    const tools: ToolSpec[] = [
      {
        definition: { name: 'repeat', description: 'Repeat tool' },
        handler: async () => {
          callCount++;
          return { count: callCount };
        }
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Repeat' } }] },
        'Done.',
        // Execution: tool call 1
        { content: '', toolCalls: [{ id: 'c1', name: 'repeat', arguments: {} }] },
        // Execution: tool call 2
        { content: '', toolCalls: [{ id: 'c2', name: 'repeat', arguments: {} }] },
        // After maxToolCalls=2, must output text
        'Stopped',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test limit'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, {
      tools,
      maxToolCalls: 2
    });

    expect(callCount).toBe(2);
    expect(result.context.executionLog?.[0].toolCalls).toHaveLength(2);
  });

  // 5. ツールエラー処理
  it('should handle tool errors gracefully', async () => {
    const tools: ToolSpec[] = [
      {
        definition: { name: 'failingTool', description: 'Failing tool' },
        handler: async () => { throw new Error('Tool failed'); }
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Use tool' } }] },
        'Done.',
        // Execution: call failing tool
        { content: '', toolCalls: [{ id: 'c1', name: 'failingTool', arguments: {} }] },
        // Execution: handle error and continue
        'Handled error',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test error'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    expect(result.context.executionLog?.[0].toolCalls?.[0].result).toBe('Tool failed');
    expect(result.context.executionLog?.[0].result).toBe('Handled error');
  });

  // 6. 不明なツール
  it('should handle unknown tool calls', async () => {
    const tools: ToolSpec[] = [
      {
        definition: { name: 'knownTool', description: 'Known tool' },
        handler: async () => ({ ok: true })
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Test' } }] },
        'Done.',
        // Execution: call unknown tool
        { content: '', toolCalls: [{ id: 'c1', name: 'unknownTool', arguments: {} }] },
        // Execution: handle unknown tool
        'Handled',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test unknown'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    const toolResult = result.context.executionLog?.[0].toolCalls?.[0].result;
    expect(typeof toolResult).toBe('string');
    expect((toolResult as string).includes('Unknown tool')).toBe(true);
  });

  // 7. maxTasks制限
  it('should limit execution to maxTasks', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning: register 6 tasks in one response
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Task 1' } },
            { id: 'tc-2', name: '__task', arguments: { id: 'task-2', description: 'Task 2' } },
            { id: 'tc-3', name: '__task', arguments: { id: 'task-3', description: 'Task 3' } },
            { id: 'tc-4', name: '__task', arguments: { id: 'task-4', description: 'Task 4' } },
            { id: 'tc-5', name: '__task', arguments: { id: 'task-5', description: 'Task 5' } },
            { id: 'tc-6', name: '__task', arguments: { id: 'task-6', description: 'Task 6' } }
          ]
        },
        'Done.',
        // Execution: only first 3 tasks executed (maxTasks=3)
        'Task 1 done',
        'Task 2 done',
        'Task 3 done',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test max tasks'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { maxTasks: 3 });

    expect(result.context.executionLog).toHaveLength(3);
  });

  // 8. 既存plan使用
  it('should use existing plan when provided', async () => {
    const plan: AgenticTaskPlan = {
      tasks: [
        { id: 'task-1', description: 'Execute', taskType: 'do' }
      ]
    };

    const driver = new TestDriver({
      responses: [
        // No planning phase - only execution and integration
        'Executed',
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Use existing plan',
      plan
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { enablePlanning: false });

    expect(result.context.executionLog).toHaveLength(1);
    expect(result.context.executionLog?.[0].taskId).toBe('task-1');
  });

  // 9. __updateState による状態引き継ぎ
  it('should handle state updates via __updateState tool', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'First task' } },
            { id: 'tc-2', name: '__task', arguments: { id: 'task-2', description: 'Second task' } }
          ]
        },
        'Done.',
        // Execution task-1: update state
        {
          content: 'Task 1 result',
          toolCalls: [{ id: 'us-1', name: '__updateState', arguments: { content: 'Context from task 1' } }]
        },
        'Task 1 done',
        // Execution task-2: use updated state
        'Task 2 done with context',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test state update'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context);

    expect(result.context.executionLog?.[0].state).toBe('Context from task 1');
    expect(result.context.state?.content).toBe('Context from task 1');
  });

  // 10. Planningでタスク0件 → エラー
  it('should throw error when planning registers no tasks', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning: text only, no __task calls
        'No tasks registered.'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test no tasks'
    };

    await expect(async () => {
      await agenticProcess(driver, { objective: ['Test'] }, context);
    }).rejects.toThrow('did not register any tasks');
  });

  // 11. 外部ツール + 組み込みツール共存
  it('should separate external tools from built-in tools in toolCalls history', async () => {
    const tools: ToolSpec[] = [
      {
        definition: { name: 'getData', description: 'Get data' },
        handler: async (args) => ({ data: `data-${args.id}` })
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Get and update' } }] },
        'Done.',
        // Execution: call external tool and built-in tool
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'getData', arguments: { id: '1' } },
            { id: 'c2', name: '__updateState', arguments: { content: 'state data' } }
          ]
        },
        'Result',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test tool separation'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    // toolCalls should only include external tools (getData), not built-in (__updateState)
    expect(result.context.executionLog?.[0].toolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[0].toolCalls?.[0].name).toBe('getData');
    // But state should be updated
    expect(result.context.executionLog?.[0].state).toBe('state data');
  });

  // 12. ツールなしワークフロー
  it('should work without any tools', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Simple task' } }] },
        'Done.',
        // Execution: text only, no tools
        'Done',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Simple workflow'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context);

    expect(result.output).toBe('Final');
    expect(result.metadata?.toolCallsUsed).toBe(0);
  });
});
