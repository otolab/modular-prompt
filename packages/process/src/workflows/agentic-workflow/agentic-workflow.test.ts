import { describe, it, expect } from 'vitest';
import { agenticProcess } from './agentic-workflow.js';
import { TestDriver } from '@modular-prompt/driver';
import type { AgenticWorkflowContext, AgenticPlan, ToolSpec } from './types.js';

describe('agenticProcess', () => {
  it('should execute a simple agent workflow', async () => {
    // Mock plan
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Analyze the input' },
        { id: 'step-2', description: 'Generate output' }
      ]
    };

    // Mock responses (4 total: planning + 2 execution + integration)
    const driver = new TestDriver({
      responses: [
        // Planning - return JSON for structured output
        JSON.stringify(plan),
        // Execution: step 1 - structured output with result and nextState
        JSON.stringify({ result: 'Analysis complete: Input analyzed successfully', nextState: 'Ready for output generation' }),
        // Execution: step 2 - structured output with result and nextState
        JSON.stringify({ result: 'Output generated successfully', nextState: 'Ready for integration' }),
        // Integration
        'Final result: Task completed successfully'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Analyze the document and extract insights',
      inputs: { data: 'test data' }
    };

    // User's module
    const userModule = {
      objective: ['文書を分析し、重要な洞察を抽出する'],
      instructions: [
        '- 文書の主要なテーマを特定する',
        '- 重要なポイントを3つ抽出する',
        '- 各ポイントを簡潔にまとめる'
      ]
    };

    const result = await agenticProcess(driver, userModule, context);

    expect(result.output).toBe('Final result: Task completed successfully');
    expect(result.context.phase).toBe('complete');
    expect(result.context.executionLog).toHaveLength(2);
    expect(result.context.executionLog?.[0].result).toBe('Analysis complete: Input analyzed successfully');
    expect(result.context.executionLog?.[1].result).toBe('Output generated successfully');
    // nextState is stored in context.state, updated after each step
    expect(result.context.state?.content).toBe('Ready for integration');
    expect(result.metadata?.planSteps).toBe(2);
    expect(result.metadata?.executedSteps).toBe(2);
  });

  it('should handle tools in workflow via tool calling', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Get data using tools' },
        { id: 'step-2', description: 'Process data' }
      ]
    };

    let toolCalled = false;
    const tools: ToolSpec[] = [
      {
        definition: {
          name: 'getData',
          description: 'Retrieve data by ID',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id']
          }
        },
        handler: async (args) => {
          toolCalled = true;
          expect(args.id).toBe('123');
          return { result: 'data retrieved' };
        }
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        JSON.stringify(plan),
        // Execution step 1: AI calls tool first
        {
          content: '',
          toolCalls: [{ id: 'call-1', name: 'getData', arguments: { id: '123' } }]
        },
        // Execution step 1: AI responds after getting tool result
        JSON.stringify({ result: 'Data retrieved and processed', nextState: 'Data available for processing' }),
        // Execution step 2: no tools
        JSON.stringify({ result: 'Processing complete', nextState: 'Ready for final output' }),
        // Integration
        'Final output'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Fetch user data and generate report'
    };

    const userModule = {
      objective: ['ユーザーデータを取得し、レポートを生成する'],
      instructions: [
        '- データを適切なフォーマットで取得',
        '- 集計結果を分かりやすく整形',
        '- サマリーを含めたレポートを作成'
      ]
    };

    const result = await agenticProcess(driver, userModule, context, { tools });

    expect(toolCalled).toBe(true);
    expect(result.context.executionLog?.[0].toolCalls).toHaveLength(1);
    expect(result.context.executionLog?.[0].toolCalls?.[0].name).toBe('getData');
    expect(result.context.executionLog?.[0].toolCalls?.[0].result).toEqual({ result: 'data retrieved' });
    expect(result.metadata?.toolCallsUsed).toBe(1);
  });

  it('should handle multiple tool calling rounds', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Search and analyze' }
      ]
    };

    const tools: ToolSpec[] = [
      {
        definition: { name: 'search', description: 'Search for information' },
        handler: async (args) => ({ results: [`result for ${args.query}`] })
      },
      {
        definition: { name: 'analyze', description: 'Analyze data' },
        handler: async (args) => ({ analysis: `analyzed: ${JSON.stringify(args.data)}` })
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning
        JSON.stringify(plan),
        // Execution step 1, round 1: search
        {
          content: 'Let me search first',
          toolCalls: [{ id: 'call-1', name: 'search', arguments: { query: 'test' } }]
        },
        // Execution step 1, round 2: analyze
        {
          content: 'Now analyze the results',
          toolCalls: [{ id: 'call-2', name: 'analyze', arguments: { data: ['result for test'] } }]
        },
        // Execution step 1, final: produce result
        JSON.stringify({ result: 'Analysis complete', nextState: 'Done' }),
        // Integration
        'Final analysis report'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Search and analyze data'
    };

    const userModule = {
      objective: ['データを検索・分析する']
    };

    const result = await agenticProcess(driver, userModule, context, { tools });

    expect(result.context.executionLog?.[0].toolCalls).toHaveLength(2);
    expect(result.context.executionLog?.[0].toolCalls?.[0].name).toBe('search');
    expect(result.context.executionLog?.[0].toolCalls?.[1].name).toBe('analyze');
    expect(result.metadata?.toolCallsUsed).toBe(2);
  });

  it('should respect maxToolCalls limit', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Repeat action' }
      ]
    };

    let callCount = 0;
    const tools: ToolSpec[] = [
      {
        definition: { name: 'repeat', description: 'Repeating tool' },
        handler: async () => {
          callCount++;
          return { count: callCount };
        }
      }
    ];

    const driver = new TestDriver({
      responses: [
        JSON.stringify(plan),
        // Tool call round 1
        { content: '', toolCalls: [{ id: 'c1', name: 'repeat', arguments: {} }] },
        // Tool call round 2
        { content: '', toolCalls: [{ id: 'c2', name: 'repeat', arguments: {} }] },
        // After maxToolCalls reached, this would be the next response
        // but since maxToolCalls=2, the second tool call response breaks the loop
        // and this becomes the final result
        JSON.stringify({ result: 'Stopped after limit', nextState: '' }),
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test tool call limit'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, {
      tools,
      maxToolCalls: 2
    });

    expect(callCount).toBe(2);
    expect(result.context.executionLog?.[0].toolCalls).toHaveLength(2);
  });

  it('should handle tool errors gracefully', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Use failing tool' }
      ]
    };

    const tools: ToolSpec[] = [
      {
        definition: { name: 'failingTool', description: 'A tool that fails' },
        handler: async () => { throw new Error('Tool failed'); }
      }
    ];

    const driver = new TestDriver({
      responses: [
        JSON.stringify(plan),
        // AI calls the failing tool
        { content: '', toolCalls: [{ id: 'c1', name: 'failingTool', arguments: {} }] },
        // AI receives error and produces final result
        JSON.stringify({ result: 'Handled error', nextState: '' }),
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test error handling'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    // Tool error is captured and returned to AI, not thrown
    expect(result.context.executionLog?.[0].toolCalls?.[0].result).toBe('Tool failed');
    expect(result.context.executionLog?.[0].result).toBe('Handled error');
  });

  it('should handle unknown tool calls', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Call unknown tool' }
      ]
    };

    const tools: ToolSpec[] = [
      {
        definition: { name: 'knownTool', description: 'A known tool' },
        handler: async () => ({ ok: true })
      }
    ];

    const driver = new TestDriver({
      responses: [
        JSON.stringify(plan),
        // AI calls a tool that doesn't exist
        { content: '', toolCalls: [{ id: 'c1', name: 'unknownTool', arguments: {} }] },
        // AI receives error and produces final result
        JSON.stringify({ result: 'Handled unknown tool', nextState: '' }),
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test unknown tool'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context, { tools });

    expect(result.context.executionLog?.[0].toolCalls?.[0].result).toBe('Unknown tool: unknownTool');
  });

  it('should limit steps to maxSteps', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Step 1' },
        { id: 'step-2', description: 'Step 2' },
        { id: 'step-3', description: 'Step 3' },
        { id: 'step-4', description: 'Step 4' },
        { id: 'step-5', description: 'Step 5' },
        { id: 'step-6', description: 'Step 6' }
      ]
    };

    const driver = new TestDriver({
      responses: [
        JSON.stringify(plan),
        JSON.stringify({ result: 'Step 1 done', nextState: 'Step 1 complete' }),
        JSON.stringify({ result: 'Step 2 done', nextState: 'Step 2 complete' }),
        JSON.stringify({ result: 'Step 3 done', nextState: 'Step 3 complete' }),
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Summarize technical specification'
    };

    const userModule = {
      objective: ['技術仕様書を要約する'],
      instructions: [
        '- 各セクションの内容を理解する',
        '- 重要な技術要件を抽出する',
        '- 全体の概要をまとめる'
      ]
    };

    const result = await agenticProcess(driver, userModule, context, { maxSteps: 3 });

    expect(result.context.executionLog).toHaveLength(3);
    expect(result.metadata?.executedSteps).toBe(3);
  });

  it('should use existing plan when provided', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Execute step' }
      ]
    };

    const driver = new TestDriver({
      responses: [
        // No planning needed - only execution + integration
        JSON.stringify({ result: 'Step executed', nextState: 'Execution complete' }),
        'Integration done'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Create monthly sales report',
      plan // Plan already provided
    };

    const userModule = {
      objective: ['月次売上レポートを作成する'],
      instructions: [
        '- 売上データを集計する',
        '- グラフとチャートを作成する',
        '- サマリーレポートにまとめる'
      ]
    };

    const result = await agenticProcess(driver, userModule, context, { enablePlanning: false });

    expect(result.context.executionLog).toHaveLength(1);
    expect(result.output).toBe('Integration done');
  });

  it('should handle workflow error in planning phase', async () => {
    const driver = new TestDriver({
      responses: [
        { content: 'Partial planning...', finishReason: 'length' }
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test error handling'
    };

    const userModule = {
      objective: ['エラーハンドリングのテスト'],
      instructions: ['- 計画フェーズでエラーが発生']
    };

    await expect(async () => {
      await agenticProcess(driver, userModule, context);
    }).rejects.toThrow('Planning failed with reason: length');
  });

  it('should handle workflow error in execution phase', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'First step' },
        { id: 'step-2', description: 'Second step' }
      ]
    };

    const driver = new TestDriver({
      responses: [
        // Planning (returns valid plan)
        JSON.stringify(plan),
        // Execution: step 1 succeeds
        JSON.stringify({ result: 'Step 1 done', nextState: 'Moving to step 2' }),
        // Execution: step 2 fails with error
        { content: 'Partial execution...', finishReason: 'error' }
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Test execution error handling'
    };

    const userModule = {
      objective: ['実行フェーズでのエラーハンドリング'],
      instructions: ['- 2番目のステップでエラーが発生']
    };

    await expect(async () => {
      await agenticProcess(driver, userModule, context);
    }).rejects.toThrow('Step execution failed with reason: error');
  });

  it('should resume from partial execution', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'First step' },
        { id: 'step-2', description: 'Second step' },
        { id: 'step-3', description: 'Third step' }
      ]
    };

    // Partial execution log (already completed step-1)
    const executionLog = [
      { stepId: 'step-1', reasoning: '', result: 'First step completed' }
    ];

    const driver = new TestDriver({
      responses: [
        // No planning needed (plan already exists)
        // Only step-2 and step-3 execution + integration
        JSON.stringify({ result: 'Second step completed', nextState: 'Ready for step 3' }),
        JSON.stringify({ result: 'Third step completed', nextState: 'All steps done' }),
        'All steps integrated'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Analyze the document and summarize',
      plan,
      executionLog,
      state: { content: 'Ready for step 2' } // State from previous step
    };

    // Same user module as initial execution
    const userModule = {
      objective: ['文書を分析し、要約する'],
      instructions: [
        '- 文書の構造を把握する',
        '- 重要な情報を抽出する',
        '- 簡潔な要約を作成する'
      ]
    };

    const result = await agenticProcess(driver, userModule, context, { enablePlanning: false });

    expect(result.context.executionLog).toHaveLength(3);
    expect(result.context.executionLog?.[0].stepId).toBe('step-1');
    expect(result.context.executionLog?.[1].stepId).toBe('step-2');
    expect(result.context.executionLog?.[2].stepId).toBe('step-3');
  });

  it('should work without any tools', async () => {
    const plan: AgenticPlan = {
      steps: [
        { id: 'step-1', description: 'Simple step' }
      ]
    };

    const driver = new TestDriver({
      responses: [
        JSON.stringify(plan),
        JSON.stringify({ result: 'Done', nextState: '' }),
        'Final'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'Simple task'
    };

    const result = await agenticProcess(driver, { objective: ['Test'] }, context);

    expect(result.output).toBe('Final');
    expect(result.metadata?.toolCallsUsed).toBe(0);
  });
});
