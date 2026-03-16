import { describe, it, expect } from 'vitest';
import { compile, merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { getTaskTypeConfig, taskCommon } from './task-types/index.js';
import type { AgenticWorkflowContext, AgenticTask } from './types.js';

function collectText(elements: any[] = []): string {
  const lines: string[] = [];
  for (const element of elements) {
    if (!element) continue;
    if (typeof element === 'string') { lines.push(element); continue; }
    if (Array.isArray(element)) { lines.push(collectText(element)); continue; }
    if (element.type === 'section' || element.type === 'subsection') {
      if (element.title) lines.push(element.title);
      if (element.items) lines.push(collectText(element.items));
      continue;
    }
    if (element.type === 'material') {
      if (element.title) lines.push(element.title);
      if (element.content) lines.push(element.content);
      continue;
    }
    if (element.content) lines.push(element.content);
  }
  return lines.join('\n');
}

describe('Agentic Workflow v2 Prompt Inspection', () => {
  const userModule: PromptModule<AgenticWorkflowContext> = {
    objective: ['文書を分析し、重要な洞察を抽出する'],
    instructions: [
      '- 文書の主要なテーマを特定する',
      '- 重要なポイントを3つ抽出する',
    ],
    terms: ['- テーマ: 文書全体を貫く中心的な概念'],
    cue: ['分析結果を日本語で報告してください'],
  };

  const taskList: AgenticTask[] = [
    { id: 1, description: 'Decompose objective into tasks', taskType: 'planning' },
    { id: 2, description: '文書のテーマを分析する', taskType: 'think' },
    { id: 3, description: 'メッセージからコンテキストを抽出する', taskType: 'extractContext', withMessages: true },
    { id: 4, description: '最終出力を生成する', taskType: 'outputMessage' },
  ];

  it('planning: instructions/guidelines をデータ側に配置する', () => {
    const context: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      userModule,
      inputs: { document: 'サンプルドキュメントの内容...' },
      taskList,
      currentTaskIndex: 0,
      executionLog: [],
    };

    const config = getTaskTypeConfig('planning');
    const workflowBase: PromptModule<AgenticWorkflowContext> = {
      objective: userModule.objective,
      terms: userModule.terms,
    };
    const prompt = compile(merge(workflowBase, taskCommon, config.module), context);

    // objective は指示側にある
    const instructionText = collectText(prompt.instructions);
    expect(instructionText).toContain('文書を分析し、重要な洞察を抽出する');
    expect(instructionText).toContain('__task');

    // ユーザーの instructions はデータ側 (materials) にある
    const dataText = collectText(prompt.data);
    expect(dataText).toContain('Instructions to decompose');
    expect(dataText).toContain('文書の主要なテーマを特定する');

    // タスクリストが methodology に表示される
    expect(instructionText).toContain('Task 1');
    expect(instructionText).toContain('planning');
  });

  it('think: description が指示に、前タスク結果がデータに入る', () => {
    const context: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      userModule,
      taskList,
      currentTaskIndex: 1,
      executionLog: [
        { taskId: 1, taskType: 'planning', result: 'Tasks registered.' },
      ],
    };

    const config = getTaskTypeConfig('think');
    const workflowBase: PromptModule<AgenticWorkflowContext> = {
      objective: userModule.objective,
      terms: userModule.terms,
    };
    const prompt = compile(merge(workflowBase, taskCommon, config.module), context);

    const instructionText = collectText(prompt.instructions);
    expect(instructionText).toContain('文書のテーマを分析する');

    // 前タスク結果が materials に入る
    const materialElements = prompt.data.filter((e: any) => e.type === 'material');
    expect(materialElements.length).toBeGreaterThanOrEqual(1);
    expect(materialElements[0].title).toContain('Task 1');
  });

  it('extractContext: messages/materials がデフォルトでデータに含まれる', () => {
    const context: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      userModule,
      taskList,
      currentTaskIndex: 2,
      executionLog: [
        { taskId: 1, taskType: 'planning', result: 'Tasks registered.' },
        { taskId: 2, taskType: 'think', result: 'テーマを特定しました' },
      ],
      messages: [
        { type: 'message', role: 'user', content: 'この文書を分析して' },
      ],
      materials: [
        { type: 'material', id: 'doc1', title: 'Document 1', content: 'ドキュメント内容' },
      ],
    };

    const config = getTaskTypeConfig('extractContext');
    const workflowBase: PromptModule<AgenticWorkflowContext> = {
      objective: userModule.objective,
      terms: userModule.terms,
    };
    const prompt = compile(merge(workflowBase, taskCommon, config.module), context);

    // messages がプロンプトに含まれる
    const dataText = collectText(prompt.data);
    expect(dataText).toContain('この文書を分析して');
    expect(dataText).toContain('ドキュメント内容');
  });

  it('outputMessage: cue が指示に、全タスク結果がデータに入る', () => {
    const context: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      userModule,
      taskList,
      currentTaskIndex: 3,
      executionLog: [
        { taskId: 1, taskType: 'planning', result: 'Tasks registered.' },
        { taskId: 2, taskType: 'think', result: 'テーマを特定しました' },
        { taskId: 3, taskType: 'extractContext', result: 'コンテキストを抽出しました' },
      ],
    };

    const config = getTaskTypeConfig('outputMessage');
    const workflowBase: PromptModule<AgenticWorkflowContext> = {
      objective: userModule.objective,
      terms: userModule.terms,
      cue: userModule.cue,
    };
    const prompt = compile(merge(workflowBase, taskCommon, config.module), context);

    // cue が output セクションに入る
    const outputText = collectText(prompt.output);
    expect(outputText).toContain('分析結果を日本語で報告してください');

    // 全タスク結果が materials に入る
    const materialElements = prompt.data.filter((e: any) => e.type === 'material');
    expect(materialElements).toHaveLength(3);
  });

  it('outputStructured: schema が output に入る', () => {
    const moduleWithSchema: PromptModule<AgenticWorkflowContext> = {
      ...userModule,
      schema: [{
        type: 'json',
        content: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      }],
    };

    const structuredTaskList: AgenticTask[] = [
      ...taskList.slice(0, 3),
      { id: 4, description: '構造化出力を生成する', taskType: 'outputStructured' },
    ];

    const context: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      userModule: moduleWithSchema,
      taskList: structuredTaskList,
      currentTaskIndex: 3,
      executionLog: [
        { taskId: 1, taskType: 'planning', result: 'Tasks registered.' },
        { taskId: 2, taskType: 'think', result: 'テーマを特定しました' },
        { taskId: 3, taskType: 'extractContext', result: 'コンテキストを抽出しました' },
      ],
    };

    const config = getTaskTypeConfig('outputStructured');
    const workflowBase: PromptModule<AgenticWorkflowContext> = {
      objective: moduleWithSchema.objective,
      terms: moduleWithSchema.terms,
      schema: moduleWithSchema.schema,
    };
    const prompt = compile(merge(workflowBase, taskCommon, config.module), context);

    // schema が metadata.outputSchema に入る
    expect(prompt.metadata?.outputSchema).toBeDefined();
    expect(prompt.metadata?.outputSchema?.properties?.summary).toBeDefined();
  });
});
