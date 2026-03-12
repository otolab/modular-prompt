import { describe, it, expect } from 'vitest';
import { compile, merge } from '@modular-prompt/core';
import { withMaterials } from './modules/material';
import { streamProcessing } from './modules/stream-processing';
import type { MaterialContext } from './modules/material';
import type { StreamProcessingContext } from './modules/stream-processing';
import { agenticProcess } from './workflows/agentic-workflow/agentic-workflow';
import type { AgenticWorkflowContext } from './workflows/agentic-workflow/types';
import { TestDriver } from '@modular-prompt/driver';

describe('integration tests', () => {
  it('materialモジュールとstreamProcessingを統合できる', () => {
    type CombinedContext = MaterialContext & StreamProcessingContext;

    const combinedModule = merge(withMaterials, streamProcessing);

    const context: CombinedContext = {
      materials: [
        { id: 'doc1', title: 'Document 1', content: 'Content 1' }
      ],
      chunks: [
        { content: 'Chunk 1' }
      ],
      state: {
        content: 'Previous state'
      }
    };

    const result = compile(combinedModule, context);

    // 両方のモジュールのセクションが含まれることを確認
    const allSections = [
      ...result.instructions,
      ...result.data,
      ...result.output
    ];

    const sectionTitles = allSections
      .filter(e => e.type === 'section')
      .map(s => s.title);

    expect(sectionTitles).toContain('Term Explanations'); // withMaterialsのterms
    expect(sectionTitles).toContain('Objective and Role'); // streamProcessingのobjective
  });
  
  it('streamProcessingで実際のプロンプトを生成できる', () => {
    const summarizeModule = {
      instructions: [
        'Summarize the key points from the input chunks',
        'Merge the summary with the current state'
      ]
    };
    
    const workflow = merge(streamProcessing, summarizeModule);
    
    const context: StreamProcessingContext = {
      chunks: [
        { content: 'This is a test chunk with some important information.' }
      ],
      state: {
        content: 'Previous summary of earlier chunks',
        usage: 100
      },
      range: { start: 1, end: 2 },
      targetTokens: 500
    };
    
    const result = compile(workflow, context);

    // プロンプトの構造を確認
    // TODO: toBeDefinedは曖昧な判定。具体的な型や構造を検証すべき
    // 例: expect(result.instructions).toBeInstanceOf(Array)
    // 例: expect(result.instructions[0]).toHaveProperty('type')
    expect(result.instructions).toBeDefined();
    expect(result.data).toBeDefined();
    expect(result.output).toBeDefined();
    
    // 各セクションに内容があることを確認
    expect(result.instructions.length).toBeGreaterThan(0);
  });

  it('agenticProcessでエンドツーエンドのワークフローが実行できる', async () => {
    // 計画、実行、統合の3フェーズを含む完全なワークフローをテスト
    const plan = {
      steps: [
        {
          id: 'step-1',
          description: '入力データを分析する',
          dos: ['データの形式を確認', '主要な項目を特定'],
          donts: ['データを変更しない']
        },
        {
          id: 'step-2',
          description: '分析結果をまとめる',
          dos: ['重要な発見を整理', '次のステップを提案'],
          donts: ['結論を急がない']
        }
      ]
    };

    const driver = new TestDriver({
      responses: [
        // Planning phase response
        JSON.stringify(plan),
        // Execution step-1 response (structured output)
        JSON.stringify({
          reasoning: 'データを確認しました',
          result: 'データは正しい形式です',
          nextState: 'データ分析完了'
        }),
        // Execution step-2 response (structured output)
        JSON.stringify({
          reasoning: '分析結果を整理しました',
          result: '重要な発見: データ品質が良好',
          nextState: 'まとめ完了'
        }),
        // Integration phase response
        'データ分析とまとめが完了しました。データ品質は良好で、次のステップに進む準備が整いました。'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'サンプルデータを分析する',
      inputs: {
        data: [1, 2, 3, 4, 5]
      }
    };

    const userModule = {
      objective: ['サンプルデータを分析する'],
      instructions: [
        '- データの形式を確認する',
        '- 統計情報を計算する',
        '- 結果をレポートする'
      ]
    };

    const result = await agenticProcess(driver, userModule, context);

    // ワークフローが正常に完了することを確認
    expect(result.output).toBeDefined();
    expect(result.context.phase).toBe('complete');
    expect(result.context.executionLog).toHaveLength(2);
    expect(result.metadata?.planSteps).toBe(2);
    expect(result.metadata?.executedSteps).toBe(2);
  });

  it('agenticProcessでツール呼び出し付きワークフローが実行できる', async () => {
    const plan = {
      steps: [
        {
          id: 'step-1',
          description: 'データを取得する'
        },
        {
          id: 'step-2',
          description: 'データを処理する'
        }
      ]
    };

    let fetchCalled = false;
    const tools = [
      {
        definition: {
          name: 'fetchData',
          description: 'データを取得する',
          parameters: {
            type: 'object',
            properties: { source: { type: 'string' } },
            required: ['source']
          }
        },
        handler: async (args: Record<string, unknown>) => {
          fetchCalled = true;
          expect(args.source).toBe('api');
          return { data: [1, 2, 3] };
        }
      }
    ];

    const driver = new TestDriver({
      responses: [
        JSON.stringify(plan),
        // Step 1: AI calls tool
        {
          content: '',
          toolCalls: [{ id: 'call-1', name: 'fetchData', arguments: { source: 'api' } }]
        },
        // Step 1: AI processes tool result
        JSON.stringify({
          reasoning: 'データ取得を実行',
          result: 'データ取得完了',
          nextState: 'データ準備完了'
        }),
        JSON.stringify({
          reasoning: 'データ処理を実行',
          result: '処理完了',
          nextState: '全工程完了'
        }),
        '全ての処理が完了しました'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'データを取得して処理する'
    };

    const userModule = {
      objective: ['データを取得して処理する']
    };

    const result = await agenticProcess(driver, userModule, context, { tools });

    // ツールが実行されたことを確認
    expect(fetchCalled).toBe(true);
    expect(result.context.executionLog?.[0].toolCalls?.[0].result).toEqual({ data: [1, 2, 3] });
    expect(result.metadata?.toolCallsUsed).toBe(1);
  });

});
