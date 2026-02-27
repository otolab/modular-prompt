/**
 * Experiment runner - orchestrates the entire experiment
 */

import { compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { formatCompletionPrompt } from '@modular-prompt/driver';
import type { AIService, QueryResult, ModelSpec, AIDriver } from '@modular-prompt/driver';
import { defaultProcess } from '@modular-prompt/process';
import type { ModuleDefinition, TestResult, TestCase, EvaluationContext, EvaluationResult } from '../types.js';
import type { DriverManager } from './driver-manager.js';
import type { LoadedEvaluator } from '../config/dynamic-loader.js';
import { EvaluatorRunner } from './evaluator.js';
import { logger as baseLogger } from '../logger.js';

const logger = baseLogger.context('runner');

interface TestPlanItem {
  testCase: TestCase;
  modelName: string;
  modelSpec: ModelSpec;
  module: ModuleDefinition;
  prompt: string;
}

export class ExperimentRunner {
  constructor(
    private aiService: AIService,
    private driverManager: DriverManager,
    private modules: ModuleDefinition[],
    private testCases: TestCase[],
    private models: Record<string, ModelSpec>,
    private repeatCount: number,
    private evaluators?: LoadedEvaluator[],
    private evaluatorModel?: { name: string; spec: ModelSpec }
  ) {}

  /**
   * Run the experiment
   *
   * @returns Array of TestResult
   */
  async run(): Promise<TestResult[]> {
    // Phase 1: テスト計画の生成
    const plan = this.buildTestPlan();
    if (plan.length === 0) {
      console.log('No test plan items generated.');
      return [];
    }

    // Phase 2: モデルごとにグループ化して実行
    const { results, evaluationContexts } = await this.executePlan(plan);

    // Phase 3: 評価フェーズ
    if (this.evaluators && this.evaluators.length > 0 && this.evaluatorModel) {
      await this.runEvaluationPhase(evaluationContexts);
    }

    return results;
  }

  /**
   * Build test plan: expand all testCase × model × module combinations
   */
  private buildTestPlan(): TestPlanItem[] {
    const plan: TestPlanItem[] = [];

    for (const testCase of this.testCases) {
      // テストケースで使うモデルを決定
      const modelsToTest: Array<{ name: string; spec: ModelSpec }> = testCase.models
        ? testCase.models.map(name => {
            const spec = this.models[name];
            if (!spec) {
              console.warn(`⚠️  Model '${name}' not found in configuration, skipping`);
              return null;
            }
            return { name, spec };
          }).filter(Boolean) as Array<{ name: string; spec: ModelSpec }>
        : Object.entries(this.models)
            .filter(([_, spec]) => !spec.disabled)
            .map(([name, spec]) => ({ name, spec }));

      for (const { name: modelName, spec: modelSpec } of modelsToTest) {
        for (const module of this.modules) {
          // compile for logging/evaluation purposes
          const compiled = compile(module.module, testCase.input);
          const prompt = formatCompletionPrompt(compiled);

          plan.push({
            testCase,
            modelName,
            modelSpec,
            module,
            prompt,
          });
        }
      }
    }

    logger.info(`Test plan: ${plan.length} items (${this.testCases.length} test cases × models × ${this.modules.length} modules)`);
    return plan;
  }

  /**
   * Execute test plan grouped by model
   */
  private async executePlan(plan: TestPlanItem[]): Promise<{
    results: TestResult[];
    evaluationContexts: EvaluationContext[];
  }> {
    const allResults: TestResult[] = [];
    const evaluationContexts: EvaluationContext[] = [];

    // モデルごとにグループ化（出現順を維持）
    const modelGroups = new Map<string, TestPlanItem[]>();
    for (const item of plan) {
      const group = modelGroups.get(item.modelName);
      if (group) {
        group.push(item);
      } else {
        modelGroups.set(item.modelName, [item]);
      }
    }

    // モデルごとに実行
    for (const [modelName, items] of modelGroups) {
      const modelSpec = items[0].modelSpec;
      console.log('='.repeat(80));
      console.log(`🤖 Model: ${modelName} (${modelSpec.provider}:${modelSpec.model})`);
      console.log('='.repeat(80));

      logger.info(`Creating driver for ${modelName} (${modelSpec.provider}:${modelSpec.model})`);
      const driver = await this.driverManager.getOrCreate(this.aiService, modelName, modelSpec);

      for (const item of items) {
        console.log(`  ── ${item.testCase.name} ──`);
        if (item.testCase.description) {
          console.log(`     ${item.testCase.description}`);
        }

        const runs = await this.runModuleTest(item.module.name, item.module.module, driver, item.testCase);

        allResults.push({
          testCase: item.testCase.name,
          model: modelName,
          module: item.module.name,
          runs: runs.map(r => ({
            success: r.success,
            elapsed: r.elapsed,
            content: r.queryResult?.content || '',
            toolCalls: r.queryResult?.toolCalls,
            finishReason: r.queryResult?.finishReason,
            error: r.error,
          })),
        });

        // Collect for evaluation
        const successfulRuns = runs.filter(r => r.success);
        if (successfulRuns.length > 0) {
          evaluationContexts.push({
            moduleName: item.module.name,
            prompt: item.prompt,
            runs: successfulRuns.map(r => ({ queryResult: r.queryResult! })),
          });
        }
      }

      // モデルの全テスト完了後にドライバーをクローズ
      logger.info(`Closing driver: ${modelName}`);
      await this.driverManager.close(modelName);
      console.log();
    }

    return { results: allResults, evaluationContexts };
  }

  /**
   * Run module test with multiple repetitions
   */
  private async runModuleTest(
    moduleName: string,
    module: PromptModule<any>,
    driver: AIDriver,
    testCase: TestCase
  ): Promise<Array<{ success: boolean; elapsed: number; queryResult?: QueryResult; error?: string }>> {
    logger.verbose(`Running ${this.repeatCount} time(s) for module: ${moduleName}`);

    const runs: Array<{ success: boolean; elapsed: number; queryResult?: QueryResult; error?: string }> = [];

    for (let i = 0; i < this.repeatCount; i++) {
      logger.verbose(`Run ${i + 1}/${this.repeatCount} for module: ${moduleName}`);

      const startTime = Date.now();
      try {
        const workflowResult = await defaultProcess(driver, module, testCase.input, {
          queryOptions: {
            temperature: 0.7,
            maxTokens: 2048,
            ...testCase.queryOptions,
          },
        });
        const elapsed = Date.now() - startTime;

        // Convert workflow result to QueryResult-like structure
        const result: QueryResult = {
          content: workflowResult.output,
          toolCalls: workflowResult.metadata?.toolCalls as any,
          finishReason: workflowResult.metadata?.finishReason as any,
          usage: workflowResult.metadata?.usage as any,
        };

        logger.verbose(`Module ${moduleName} run ${i + 1}: Success (${elapsed}ms)`);

        // Display result summary (思考ブロックはプレビューから除外)
        const displayContent = result.content
          .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
          .replace(/^[\s\S]*?<\/think>\s*/g, '');
        const contentPreview = displayContent.length > 200
          ? displayContent.substring(0, 200) + '...'
          : displayContent;
        console.log(`   ✅ [${moduleName}] run ${i + 1} (${elapsed}ms) finishReason=${result.finishReason || 'unknown'}`);
        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const tc of result.toolCalls) {
            console.log(`      🔧 toolCall: ${tc.name}(${JSON.stringify(tc.arguments)})`);
          }
        }
        if (contentPreview.trim()) {
          console.log(`      📝 ${contentPreview}`);
        }

        runs.push({
          success: true,
          elapsed,
          queryResult: result,
        });
      } catch (error) {
        const elapsed = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Module ${moduleName} run ${i + 1}: Error (${elapsed}ms): ${errorMessage}`);
        runs.push({
          success: false,
          elapsed,
          error: errorMessage,
        });
      }
    }

    return runs;
  }

  /**
   * Run evaluation phase
   */
  private async runEvaluationPhase(
    evaluationContexts: EvaluationContext[]
  ): Promise<void> {
    console.log();
    console.log('='.repeat(80));
    console.log('🔍 Evaluation Phase');
    console.log('='.repeat(80));
    console.log();

    const evaluatorRunner = new EvaluatorRunner(this.aiService, this.evaluatorModel!.spec);
    const allEvaluations: EvaluationResult[] = [];

    // Evaluate each module with each evaluator
    for (const context of evaluationContexts) {
      console.log(`📦 Evaluating: ${context.moduleName}`);
      console.log();

      for (const evaluator of this.evaluators!) {
        const result = await evaluatorRunner.evaluate(evaluator, context);
        allEvaluations.push(result);
      }
    }

    // Display all evaluation results
    evaluatorRunner.displayResults(allEvaluations, this.evaluators);
  }

}
