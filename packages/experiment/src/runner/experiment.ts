/**
 * Experiment runner - orchestrates the entire experiment
 */

import { formatCompletionPrompt } from '@modular-prompt/driver';
import type { AIService, QueryResult, ModelSpec } from '@modular-prompt/driver';
import type { ModuleDefinition, TestResult, TestCase, EvaluationContext, EvaluationResult } from '../types.js';
import type { DriverManager } from './driver-manager.js';
import type { LoadedEvaluator } from '../config/dynamic-loader.js';
import { EvaluatorRunner } from './evaluator.js';
import { logger as baseLogger } from '../logger.js';

const logger = baseLogger.context('runner');

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
    const allResults: TestResult[] = [];
    const evaluationContexts: EvaluationContext[] = [];

    // ドライバー切り替えをテストケースをまたいでトラッキング
    let activeModelName: string | null = null;

    for (const testCase of this.testCases) {
      console.log('─'.repeat(80));
      console.log(`Test Case: ${testCase.name}`);
      if (testCase.description) {
        console.log(`Description: ${testCase.description}`);
      }
      console.log('─'.repeat(80));
      console.log();

      // Compile all modules with testCase.input as context
      const compiledModules = this.modules.map(module => {
        logger.verbose(`Compiling prompt for module: ${module.name}`);
        const compiled = module.compile(testCase.input);
        const prompt = formatCompletionPrompt(compiled);
        logger.verbose(`Prompt length for ${module.name}: ${prompt.length} chars`);

        return {
          name: module.name,
          compiled,
          prompt,
        };
      });

      // Compare prompts if multiple modules
      if (compiledModules.length > 1) {
        this.comparePrompts(compiledModules);
      }

      // Determine which models to test with this testCase
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

      if (modelsToTest.length === 0) {
        console.log('⚠️  No models to test for this test case, skipping');
        console.log();
        continue;
      }

      // Test with each model
      for (const { name: modelName, spec: modelSpec } of modelsToTest) {
        // モデル切り替え: 前のドライバーをクローズしてから新しいモデルを起動
        if (activeModelName && activeModelName !== modelName) {
          logger.info(`Closing driver: ${activeModelName} (switching to ${modelName})`);
          await this.driverManager.close(activeModelName);
          activeModelName = null;
        }

        if (activeModelName === modelName) {
          logger.verbose(`Reusing driver for ${modelName}`);
        } else {
          logger.info(`Creating new driver for ${modelName} (${modelSpec.provider}:${modelSpec.model})`);
        }
        console.log(`🤖 Testing with ${modelName} (${modelSpec.provider}:${modelSpec.model})`);

        // Get or create driver for this model
        const driver = await this.driverManager.getOrCreate(this.aiService, modelName, modelSpec);
        activeModelName = modelName;

        // Test each module
        for (const { name, compiled, prompt } of compiledModules) {
          const runs = await this.runModuleTest(name, compiled, driver, testCase);

          allResults.push({
            testCase: testCase.name,
            model: modelName,
            module: name,
            runs: runs.map(r => ({
              success: r.success,
              elapsed: r.elapsed,
              content: r.queryResult?.content || '',
              toolCalls: r.queryResult?.toolCalls,
              finishReason: r.queryResult?.finishReason,
              error: r.error,
            })),
          });

          // Collect for evaluation (if all runs succeeded)
          const successfulRuns = runs.filter(r => r.success);
          if (successfulRuns.length > 0) {
            evaluationContexts.push({
              moduleName: name,
              prompt,
              runs: successfulRuns.map(r => ({ queryResult: r.queryResult! })),
            });
          }
        }
      }
    }

    // Run evaluation phase if evaluators are provided
    if (this.evaluators && this.evaluators.length > 0 && this.evaluatorModel) {
      await this.runEvaluationPhase(evaluationContexts);
    }

    return allResults;
  }

  /**
   * Run module test with multiple repetitions
   */
  private async runModuleTest(
    moduleName: string,
    compiled: any,
    driver: any,
    testCase: TestCase
  ): Promise<Array<{ success: boolean; elapsed: number; queryResult?: QueryResult; error?: string }>> {
    logger.verbose(`Running ${this.repeatCount} time(s) for module: ${moduleName}`);

    const runs: Array<{ success: boolean; elapsed: number; queryResult?: QueryResult; error?: string }> = [];

    for (let i = 0; i < this.repeatCount; i++) {
      logger.verbose(`Run ${i + 1}/${this.repeatCount} for module: ${moduleName}`);

      const startTime = Date.now();
      try {
        const result = await driver.query(compiled, {
          temperature: 0.7,
          maxTokens: 2048,
          ...testCase.queryOptions,
        });
        const elapsed = Date.now() - startTime;

        logger.verbose(`Module ${moduleName} run ${i + 1}: Success (${elapsed}ms)`);

        // Display result summary (思考ブロックはプレビューから除外)
        // パターン: <think>...</think> または 先頭から</think>まで（テンプレートが<think>を付与する場合）
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

  /**
   * Compare prompts across modules
   */
  private comparePrompts(compiledModules: Array<{ name: string; prompt: string }>): void {
    console.log('📊 Prompt Comparison:');

    for (let i = 0; i < compiledModules.length; i++) {
      const module1 = compiledModules[i];

      for (let j = i + 1; j < compiledModules.length; j++) {
        const module2 = compiledModules[j];

        if (module1.prompt === module2.prompt) {
          console.log(`   ✅ [${module1.name}] and [${module2.name}] are identical`);
        } else {
          console.log(`   ⚠️  [${module1.name}] and [${module2.name}] differ`);
          logger.verbose(`Prompt comparison details:`);
          logger.verbose(`  ${module1.name}: ${module1.prompt.length} chars`);
          logger.verbose(`  ${module2.name}: ${module2.prompt.length} chars`);
          logger.verbose(`  Diff: ${module2.prompt.length - module1.prompt.length} chars`);

          // Find first difference (verbose only)
          for (let k = 0; k < Math.max(module1.prompt.length, module2.prompt.length); k++) {
            if (module1.prompt[k] !== module2.prompt[k]) {
              logger.verbose(`  First diff at position ${k}:`);
              logger.verbose(`    ${module1.name}: ${JSON.stringify(module1.prompt.substring(k, k + 50))}`);
              logger.verbose(`    ${module2.name}: ${JSON.stringify(module2.prompt.substring(k, k + 50))}`);
              break;
            }
          }
        }
      }
    }

    console.log();
  }
}
