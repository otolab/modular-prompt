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
    // Planning → Think×2 → OutputMessage の4タスクシーケンス
    const driver = new TestDriver({
      responses: [
        // Planning: __task で2タスク登録（v2では id パラメータなし）
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__task', arguments: { description: '入力データを分析する' } },
            { id: 'tc-2', name: '__task', arguments: { description: '分析結果をまとめる' } },
          ]
        },
        // Planning: ツール結果受け取り後に終了
        'Plan complete.',
        // Think task 1: テキスト出力が result
        'データは正しい形式です',
        // Think task 2: テキスト出力が result
        '重要な発見: データ品質が良好',
        // OutputMessage
        'データ分析とまとめが完了しました。データ品質は良好で、次のステップに進む準備が整いました。'
      ]
    });

    const context: AgenticWorkflowContext = {
      objective: 'サンプルデータを分析する',
      inputs: { data: [1, 2, 3, 4, 5] }
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

    expect(result.output).toBeDefined();
    // v2では phase なし、taskList あり
    expect(result.context.taskList).toHaveLength(4); // planning + think×2 + outputMessage
    // executionLog には4タスク分
    expect(result.context.executionLog).toHaveLength(4);
    expect(result.metadata?.planTasks).toBe(4);
    expect(result.metadata?.executedTasks).toBe(4);
  });

  it('agenticProcessで外部ツール呼び出しがpendingとして返される', async () => {
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
        handler: async () => { fetchCalled = true; return {}; }
      }
    ];

    const driver = new TestDriver({
      responses: [
        // Planning: __task で2タスク登録（v2では id パラメータなし）
        {
          content: '',
          toolCalls: [
            { id: 'tc-1', name: '__task', arguments: { description: 'データを取得する' } },
            { id: 'tc-2', name: '__task', arguments: { description: 'データを処理する' } },
          ]
        },
        'Plan done.',
        // Think task 1: AI calls external tool → returned as pending
        {
          content: 'データ取得が必要',
          toolCalls: [{ id: 'call-1', name: 'fetchData', arguments: { source: 'api' } }]
        },
        // Think task 2: テキスト出力のみ
        '処理完了',
        // OutputMessage
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

    // 外部ツールのhandlerは呼ばれない
    expect(fetchCalled).toBe(false);
    // pendingToolCallsとして返される（executionLog[1]がthink task 1）
    expect(result.context.executionLog?.[1].pendingToolCalls?.[0].name).toBe('fetchData');
    expect(result.context.executionLog?.[1].pendingToolCalls?.[0].arguments).toEqual({ source: 'api' });
    expect(result.metadata?.toolCallsUsed).toBe(1);
  });

});
