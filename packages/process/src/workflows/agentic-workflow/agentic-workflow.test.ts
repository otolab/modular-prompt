import { describe, it, expect } from 'vitest';
import { agenticProcess } from './agentic-workflow.js';
import { TestDriver } from '@modular-prompt/driver';
import type { AgenticWorkflowContext, ToolSpec } from './types.js';

describe('agenticProcess v2', () => {
  // 1. 基本ワークフロー
  it('should execute basic workflow with planning and tasks', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning: __task ツール呼び出し2回（id なし、description のみ）
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__task', arguments: { description: 'Analyze input data' } },
            { id: 'tc-2', name: '__task', arguments: { description: 'Process results' } }
          ]
        },
        // Planning: テキスト出力（ツール結果受信後に planning 終了）
        'Planning complete.',
        // Think task 1
        'Analysis result',
        // Think task 2
        'Processing result',
        // OutputMessage
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
    expect(result.context.taskList).toHaveLength(4); // planning + think×2 + outputMessage
    expect(result.context.taskList?.[0].taskType).toBe('planning');
    expect(result.context.taskList?.[1].taskType).toBe('think');
    expect(result.context.taskList?.[2].taskType).toBe('think');
    expect(result.context.taskList?.[3].taskType).toBe('outputMessage');
    expect(result.context.executionLog).toHaveLength(4);
    expect(result.context.executionLog?.[0].taskId).toBe(1);
    expect(result.context.executionLog?.[0].taskType).toBe('planning');
    expect(result.context.executionLog?.[1].taskId).toBe(3);
    expect(result.context.executionLog?.[1].result).toBe('Analysis result');
    expect(result.context.executionLog?.[2].taskId).toBe(4);
    expect(result.context.executionLog?.[2].result).toBe('Processing result');
    expect(result.context.executionLog?.[3].taskId).toBe(2);
    expect(result.context.executionLog?.[3].taskType).toBe('outputMessage');
    expect(result.metadata?.planTasks).toBe(4);
    expect(result.metadata?.executedTasks).toBe(4);
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
          toolCalls: [{ id: 'tc-1', name: '__task', arguments: { description: 'Get external data' } }]
        },
        'Planning done.',
        // Think: 外部ツール呼び出し → pending として返す
        {
          content: 'I need to get data',
          toolCalls: [{ id: 'call-1', name: 'getData', arguments: { id: '123' } }]
        },
        // OutputMessage
        'Final output'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Get and process data'
    };

    const result = await agenticProcess(
      driver,
      { objective: ['Test'] },
      context,
      { tools }
    );

    // 外部ツールのハンドラは呼ばれない
    expect(toolCalled).toBe(false);
    // pendingToolCalls に含まれている
    expect(result.context.executionLog?.[1].pendingToolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[1].pendingToolCalls?.[0].name).toBe('getData');
    expect(result.context.executionLog?.[1].pendingToolCalls?.[0].arguments).toEqual({ id: '123' });
    expect(result.metadata?.toolCallsUsed).toBe(1);
    expect(result.metadata?.finishReason).toBe('tool_calls');
  });

  // 3. ツールなしワークフロー
  it('should work without any tool calls', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning: タスク登録
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__task', arguments: { description: 'Simple task' } }]
        },
        'Planning done.',
        // Think: テキストのみ
        'Think result',
        // OutputMessage
        'Final output'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Simple workflow'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context);

    expect(result.output).toBe('Final output');
    expect(result.metadata?.toolCallsUsed).toBe(0);
    expect(result.metadata?.finishReason).toBe('stop');
  });

  // 4. maxTasks 制限
  it('should limit execution to maxTasks', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning: 5タスク登録
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__task', arguments: { description: 'Task 1' } },
            { id: 'tc-2', name: '__task', arguments: { description: 'Task 2' } },
            { id: 'tc-3', name: '__task', arguments: { description: 'Task 3' } },
            { id: 'tc-4', name: '__task', arguments: { description: 'Task 4' } },
            { id: 'tc-5', name: '__task', arguments: { description: 'Task 5' } }
          ]
        },
        'Planning done.',
        // Execution: maxTasks=3 なので 3タスクまで実行
        'Task 1 done',
        'Task 2 done',
        'Task 3 done'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test max tasks'
    };

    const result = await agenticProcess(
      driver,
      { objective: ['Test'] },
      context,
      { maxTasks: 3 }
    );

    // planning (1) + think (2) までの 3タスクのみ実行
    expect(result.context.executionLog).toHaveLength(3);
    expect(result.metadata?.executedTasks).toBe(3);
    // taskList は全部で 7個（planning + think×5 + outputMessage）
    expect(result.context.taskList).toHaveLength(7);
    expect(result.metadata?.planTasks).toBe(7);
  });

  // 5. 既存 taskList 使用（enablePlanning=false）
  it('should use existing taskList when enablePlanning is false', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning スキップ、直接 think から実行
        'Think result',
        // OutputMessage
        'Final output'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Use existing taskList',
      taskList: [
        { id: 1, description: 'Execute task', taskType: 'think' },
        { id: 2, description: 'Generate output', taskType: 'outputMessage' }
      ]
    };

    const result = await agenticProcess(
      driver,
      { objective: ['Test'] },
      context,
      { enablePlanning: false }
    );

    expect(result.context.executionLog).toHaveLength(2);
    expect(result.context.executionLog?.[0].taskId).toBe(1);
    expect(result.context.executionLog?.[0].taskType).toBe('think');
    expect(result.context.executionLog?.[0].result).toBe('Think result');
    expect(result.context.executionLog?.[1].taskId).toBe(2);
    expect(result.context.executionLog?.[1].taskType).toBe('outputMessage');
    expect(result.output).toBe('Final output');
  });

  // 6. __time ビルトインツール
  it('should handle __time builtin tool and continue loop', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__task', arguments: { description: 'Check time' } }]
        },
        'Planning done.',
        // Think: __time ツール呼び出し → ループ継続
        {
          content: '',
          toolCalls: [{ id: 'c1', name: '__time', arguments: {} }]
        },
        // Think: テキスト結果
        'Current time noted.',
        // OutputMessage
        'Final output'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Check time'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context);

    expect(result.context.executionLog?.[1].result).toBe('Current time noted.');
    // __time は builtin なので pendingToolCalls にはない
    expect(result.context.executionLog?.[1].pendingToolCalls).toBeUndefined();
    expect(result.metadata?.finishReason).toBe('stop');
  });

  // 7. schema ありの場合は outputStructured
  it('should use outputStructured when schema is provided', async () => {
    const driver = new TestDriver({
      responses: [
        // Planning
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: '__task', arguments: { description: 'Analyze' } }]
        },
        'Planning done.',
        // Think
        'Analysis complete',
        // OutputStructured
        '{"result": "structured output"}'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Generate structured output'
    };

    const userModule = {
      objective: ['Test'],
      schema: {
        type: 'object',
        properties: {
          result: { type: 'string' }
        }
      }
    };

    const result = await agenticProcess(driver, userModule, context);

    // taskList の最後のタスクは outputStructured
    const lastTask = result.context.taskList?.[result.context.taskList.length - 1];
    expect(lastTask?.taskType).toBe('outputStructured');
    expect(result.output).toBe('{"result": "structured output"}');
  });
});
