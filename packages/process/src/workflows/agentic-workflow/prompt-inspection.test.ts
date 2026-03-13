import { describe, it, expect } from 'vitest';
import { compile, merge } from '@modular-prompt/core';
import { agentic } from './modules/agentic.js';
import { planning } from './modules/planning.js';
import { execution } from './modules/execution.js';
import { integration } from './modules/integration.js';
import type { AgenticWorkflowContext, AgenticTaskPlan } from './types.js';

function collectText(elements: any[] = []): string {
  const lines: string[] = [];
  for (const element of elements) {
    if (!element) {
      continue;
    }
    if (typeof element === 'string') {
      lines.push(element);
      continue;
    }
    if (Array.isArray(element)) {
      lines.push(collectText(element));
      continue;
    }
    if (element.type === 'section' || element.type === 'subsection') {
      if (element.title) {
        lines.push(element.title);
      }
      if (element.items) {
        lines.push(collectText(element.items));
      }
      continue;
    }
    if (element.type === 'material') {
      if (element.title) {
        lines.push(element.title);
      }
      if (element.content) {
        lines.push(element.content);
      }
      continue;
    }
    if (element.type === 'text') {
      if (element.content) {
        lines.push(element.content);
      }
      continue;
    }
    if (element.content) {
      lines.push(element.content);
    }
  }
  return lines.join('\n');
}

describe('Agent Workflow Prompt Inspection', () => {
  const userModule = {
    objective: ['文書を分析し、重要な洞察を抽出する'],
    instructions: [
      '- 文書の主要なテーマを特定する',
      '- 重要なポイントを3つ抽出する',
      '- 各ポイントを簡潔にまとめる'
    ]
  };

  const plan: AgenticTaskPlan = {
    tasks: [
      {
        id: 'task-1',
        description: '文書全体を読み、主要なテーマを特定する',
        taskType: 'think',
        guidelines: ['文書全体の文脈を把握する', 'テーマの一貫性を確認する'],
        constraints: ['細部に固執しない']
      },
      {
        id: 'task-2',
        description: '特定したテーマに関連する重要なポイントを3つ抽出する',
        taskType: 'context',
        guidelines: ['テーマとの関連性を重視する', '具体的で実行可能なポイントを選ぶ'],
        constraints: ['テーマと無関係な情報を含めない']
      },
      {
        id: 'task-3',
        description: '抽出した各ポイントを簡潔にまとめる',
        taskType: 'summarize',
        guidelines: ['1-2文で要約する', '明確で簡潔な表現を使う'],
        constraints: ['冗長な説明を避ける']
      },
      {
        id: 'task-4',
        description: 'テーマとポイントを統合し、洞察として整理する',
        guidelines: ['全体の一貫性を確認する', '洞察の価値を明確にする'],
        constraints: ['単なる要約に終わらない']
      }
    ]
  };

  const taskExecutionResults = [
    {
      taskId: 'task-1',
      taskType: 'think' as const,
      result: '文書全体を分析し、主要なテーマを特定しました。\n\n特定されたテーマ:\n- イノベーションと技術革新\n- 持続可能性と環境配慮\n- 社会的責任の重視',
      state: 'テーマの特定が完了。次はポイントの抽出に進みます。'
    },
    {
      taskId: 'task-2',
      taskType: 'context' as const,
      result: '特定したテーマに関連する重要なポイントを抽出しました。\n\n抽出されたポイント:\n1. 技術革新による業務効率化と競争力強化\n2. 環境への配慮と資源の持続的利用\n3. 社会的責任を重視した企業活動',
      state: 'ポイントの抽出が完了。次は各ポイントの要約に進みます。'
    },
    {
      taskId: 'task-3',
      taskType: 'summarize' as const,
      result: '各ポイントを簡潔にまとめました。\n\nポイント1: 新技術の導入により業務プロセスを効率化\n\nポイント2: 環境負荷を最小限に抑え、再生可能資源の活用を推進\n\nポイント3: ステークホルダーへの責任を果たし、持続可能な社会の実現に貢献',
      state: 'ポイントの要約が完了。次は全体の統合に進みます。'
    },
    {
      taskId: 'task-4',
      result: 'テーマとポイントを統合し、最終的な洞察としてまとめました。\n\n洞察:\nイノベーションと持続可能性を両立させる戦略的アプローチが重要です。',
      state: '全ステップが完了しました。統合フェーズに進みます。'
    }
  ];

  it('should include planning requirements and __task tool instructions', () => {
    const planningContext: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      inputs: { document: 'サンプルドキュメントの内容...' }
    };

    const mergedPlanning = merge(agentic, planning, userModule);
    const planningPrompt = compile(mergedPlanning, planningContext);

    const instructionText = collectText(planningPrompt.instructions);
    expect(instructionText).toContain('Planning Requirements');
    expect(instructionText).toContain('__task');

    const dataText = collectText(planningPrompt.data);
    expect(dataText).toContain('Phase: planning');
    expect(dataText).toContain('サンプルドキュメントの内容');

    const outputText = collectText(planningPrompt.output);
    expect(outputText).toContain('__task');
  });

  it('should surface current task context and previous logs in execution phase', () => {
    const executionContext: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      inputs: { document: 'サンプルドキュメントの内容...' },
      plan,
      currentTask: plan.tasks[1],
      executionLog: [taskExecutionResults[0]],
      state: {
        content: taskExecutionResults[0].state!,
        usage: 1700
      }
    };

    const mergedExecution = merge(agentic, execution, userModule);
    const executionPrompt = compile(mergedExecution, executionContext);

    const instructionText = collectText(executionPrompt.instructions);
    expect(instructionText).toContain('**Current Phase: Execution**');
    expect(instructionText).toContain(plan.tasks[1].description);
    expect(instructionText).toContain('[Currently executing]');

    const dataText = collectText(executionPrompt.data);
    expect(dataText).toContain('Progress: 1/4 tasks completed');
    expect(dataText).toContain('テーマの特定が完了。次はポイントの抽出に進みます。');

    const materialElements = executionPrompt.data.filter((element: any) => element.type === 'material');
    expect(materialElements).toHaveLength(1);
    expect(materialElements[0].title).toContain('Previous task decision: task-1');
    expect(materialElements[0].content).toContain('主要なテーマ');
  });

  it('should include all execution results in the integration phase', () => {
    const integrationContext: AgenticWorkflowContext = {
      objective: '文書を分析し、重要な洞察を抽出する',
      inputs: { document: 'サンプルドキュメントの内容...' },
      plan,
      executionLog: taskExecutionResults,
      state: {
        content: '全てのステップが完了しました',
        usage: 4200
      }
    };

    const mergedIntegration = merge(agentic, integration, userModule);
    const integrationPrompt = compile(mergedIntegration, integrationContext);

    const instructionText = collectText(integrationPrompt.instructions);
    expect(instructionText).toContain('Integration Phase Process');
    expect(instructionText).toContain('Execution Plan (All Tasks Completed)');

    const materialElements = integrationPrompt.data.filter((element: any) => element.type === 'material');
    expect(materialElements).toHaveLength(taskExecutionResults.length);
    expect(materialElements[materialElements.length - 1].content).toContain('洞察');

    const dataText = collectText(integrationPrompt.data);
    expect(dataText).toContain('All 4 tasks completed');
  });
});
