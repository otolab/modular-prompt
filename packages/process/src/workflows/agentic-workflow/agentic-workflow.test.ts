import { describe, it, expect } from 'vitest';
import { agenticProcess } from './agentic-workflow.js';
import { TestDriver } from '@modular-prompt/driver';
import type { ToolSpec } from './types.js';

describe('agenticProcess v2', () => {
  // 1. 基本ワークフロー
  it('should execute basic workflow with planning and tasks', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning: __register_tasks（1回で完了）
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__register_tasks', arguments: {
              tasks: [
                { instruction: 'Analyze input data' },
                { instruction: 'Process results' },
              ]
            }},
          ]
        },
        // Think task 1
        'Analysis result',
        // Think task 2
        'Processing result',
        // Auto-appended output
        'Final result'
      ]
    });

    const result = await agenticProcess(driver, { objective: ['Process data'] }, {});

    expect(result.output).toBe('Final result');
    expect(result.context.taskList).toHaveLength(4); // planning + think×2 + auto output
    expect(result.context.taskList?.[0].taskType).toBe('planning');
    expect(result.context.taskList?.[1].taskType).toBe('think');
    expect(result.context.taskList?.[2].taskType).toBe('think');
    expect(result.context.taskList?.[3].taskType).toBe('output');
    expect(result.context.executionLog).toHaveLength(4);
    expect(result.context.executionLog?.[0].taskType).toBe('planning');
    expect(result.context.executionLog?.[1].result).toBe('Analysis result');
    expect(result.context.executionLog?.[2].result).toBe('Processing result');
    expect(result.context.executionLog?.[3].taskType).toBe('output');
  });

  // 2. 外部ツール呼び出しは pending として返す
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
        handler: async () => {
          toolCalled = true;
          return { data: 'test' };
        }
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__register_tasks', arguments: {
            tasks: [{ instruction: 'Get external data' }]
          }}]
        },
        // Think: 外部ツール呼び出し → pending として返す
        {
          content: 'I need to get data',
          toolCalls: [{ id: 'call-1', name: 'getData', arguments: { id: '123' } }]
        },
        // Auto-appended output
        'Final output'
      ]
    });

    const result = await agenticProcess(
      driver,
      { objective: ['Test'] },
      {},
      { tools }
    );

    expect(toolCalled).toBe(false);
    expect(result.context.executionLog?.[1].pendingToolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[1].pendingToolCalls?.[0].name).toBe('getData');
    expect(result.metadata?.toolCallsUsed).toBe(1);
    expect(result.metadata?.finishReason).toBe('tool_calls');
  });

  // 3. ツールなしワークフロー
  it('should work without any tool calls', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__register_tasks', arguments: {
            tasks: [{ instruction: 'Simple task' }]
          }}]
        },
        // Think
        'Think result',
        // Auto-appended output
        'Final output'
      ]
    });

    const result = await agenticProcess(driver, { objective: ['Test'] }, {});

    expect(result.output).toBe('Final output');
    expect(result.metadata?.toolCallsUsed).toBe(0);
    expect(result.metadata?.finishReason).toBe('stop');
  });

  // 4. maxTasks 制限（output は自動追加されるので maxTasks 内）
  it('should limit execution to maxTasks', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning: 5タスク登録
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__register_tasks', arguments: {
            tasks: [
              { instruction: 'Task 1' },
              { instruction: 'Task 2' },
              { instruction: 'Task 3' },
              { instruction: 'Task 4' },
              { instruction: 'Task 5' },
            ]
          }}]
        },
        // maxTasks=3: planning + think×2 まで実行
        'Task 1 done',
        'Task 2 done',
        // Auto-appended output (maxTasks reached, but output is always appended)
        'Final output'
      ]
    });

    const result = await agenticProcess(
      driver,
      { objective: ['Test'] },
      {},
      { maxTasks: 3 }
    );

    // planning (1) + think (2) = 3タスク実行、+ auto output = 4
    expect(result.context.executionLog).toHaveLength(4);
    expect(result.context.executionLog?.[3].taskType).toBe('output');
    expect(result.metadata?.executedTasks).toBe(4);
  });

  // 5. enablePlanning=false で output のみ実行
  it('should skip planning and generate output directly when enablePlanning is false', async () => {
    const driver = new TestDriver({
      responses: [
        'Final output'
      ]
    });

    const result = await agenticProcess(
      driver,
      { objective: ['Test'] },
      {},
      { enablePlanning: false }
    );

    expect(result.context.executionLog).toHaveLength(1);
    expect(result.context.executionLog?.[0].taskType).toBe('output');
    expect(result.output).toBe('Final output');
  });

  // 6. __time ビルトインツール（1回のqueryでtool実行、結果は次タスクに渡る）
  it('should execute __time builtin tool and pass result to next task', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__register_tasks', arguments: {
            tasks: [{ instruction: 'Check time' }]
          }}]
        },
        // Think: __time ツール呼び出し（1回のqueryで完了、tool結果は次タスクへ）
        {
          content: 'Checking time now.',
          toolCalls: [{ id: 'c1', name: '__time', arguments: {} }]
        },
        // Auto-appended output
        'Final output'
      ]
    });

    const result = await agenticProcess(driver, { objective: ['Test'] }, {});

    expect(result.context.executionLog?.[1].result).toBe('Checking time now.');
    expect(result.context.executionLog?.[1].toolCallLog).toHaveLength(1);
    expect(result.context.executionLog?.[1].toolCallLog?.[0].name).toBe('__time');
    expect(result.context.executionLog?.[1].pendingToolCalls).toBeUndefined();
    expect(result.metadata?.finishReason).toBe('stop');
  });

  // 7. schema ありの場合も output（自動切替）
  it('should auto-detect schema and use output type', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__register_tasks', arguments: {
            tasks: [{ instruction: 'Analyze' }]
          }}]
        },
        // Think
        'Analysis complete',
        // Auto-appended output (with schema)
        '{"result": "structured output"}'
      ]
    });

    const userModule = {
      objective: ['Test'],
      schema: {
        type: 'object',
        properties: {
          result: { type: 'string' }
        }
      }
    };

    const result = await agenticProcess(driver, userModule, {});

    const lastTask = result.context.taskList?.[result.context.taskList.length - 1];
    expect(lastTask?.taskType).toBe('output');
    expect(result.output).toBe('{"result": "structured output"}');
  });
});
