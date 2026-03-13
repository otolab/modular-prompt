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
  // 2. 外部ツール呼び出しは実行せずpendingとして返す
  it('should return external tool calls as pending without executing', async () => {
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
        handler: async () => { toolCalled = true; return {}; }
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Get data' } }] },
        'Done.',
        // Execution: LLM requests external tool → returned immediately as pending
        { content: 'I need to get data', toolCalls: [{ id: 'call-1', name: 'getData', arguments: { id: '123' } }] },
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Get and process data'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    // External tool handler should NOT be called
    expect(toolCalled).toBe(false);
    // pendingToolCalls should contain the request
    expect(result.context.executionLog?.[0].pendingToolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[0].pendingToolCalls?.[0].name).toBe('getData');
    expect(result.context.executionLog?.[0].pendingToolCalls?.[0].arguments).toEqual({ id: '123' });
    expect(result.metadata?.toolCallsUsed).toBe(1);
  });

  // 3. builtin と external が混在した場合、builtinは実行し外部はpendingとして返す
  it('should execute builtin tools but return external as pending', async () => {
    const tools: ToolSpec[] = [
      {
        definition: { name: 'search', description: 'Search data' },
        handler: async () => ({ results: [] })
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Search' } }] },
        'Done.',
        // Execution: LLM calls __updateState (builtin) + search (external)
        { content: 'Need to search', toolCalls: [
          { id: 'c1', name: '__updateState', arguments: { content: 'searching' } },
          { id: 'c2', name: 'search', arguments: { query: 'test' } }
        ]},
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = { objective: 'Test mixed' };
    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    // __updateState was executed (state is set)
    expect(result.context.executionLog?.[0].state).toBe('searching');
    // search was NOT executed, returned as pending
    expect(result.context.executionLog?.[0].pendingToolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[0].pendingToolCalls?.[0].name).toBe('search');
  });

  // 4. builtin のみのツール呼び出しはループを続ける
  it('should continue loop when only builtin tools are called', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Work' } }] },
        'Done.',
        // Execution round 1: __updateState (builtin) → loop continues
        { content: '', toolCalls: [{ id: 'c1', name: '__updateState', arguments: { content: 'step 1 done' } }] },
        // Execution round 2: text output → loop ends
        'Task complete',
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = { objective: 'Test builtin loop' };
    const result = await agenticProcess(driver, { objective: ['Test'] }, context);

    expect(result.context.executionLog?.[0].result).toBe('Task complete');
    expect(result.context.executionLog?.[0].state).toBe('step 1 done');
    expect(result.context.executionLog?.[0].pendingToolCalls).toBeUndefined();
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
  it('should separate external tools from built-in tools', async () => {
    const tools: ToolSpec[] = [
      {
        definition: { name: 'getData', description: 'Get data' },
        handler: async () => ({})
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        { content: '', toolCalls: [{ id: 'tc-1', name: '__task', arguments: { id: 'task-1', description: 'Get and update' } }] },
        'Done.',
        // Execution: builtin (__updateState) is executed, external (getData) → pending
        {
          content: 'Need data',
          toolCalls: [
            { id: 'c1', name: '__updateState', arguments: { content: 'state data' } },
            { id: 'c2', name: 'getData', arguments: { id: '1' } }
          ]
        },
        // Integration
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test tool separation'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    // pendingToolCalls should only include external tool (getData)
    expect(result.context.executionLog?.[0].pendingToolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[0].pendingToolCalls?.[0].name).toBe('getData');
    // __updateState was executed
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
