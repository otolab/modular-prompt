/**
 * Driver Registry Implementation
 * ドライバレジストリの実装
 */

import type { AIDriver } from '../types.js';
import { Logger, type LogLevel } from '@modular-prompt/utils';

// 標準ドライバーを個別インポート
import { MlxDriver } from '../mlx-ml/mlx-driver.js';
import { OpenAIDriver } from '../openai/openai-driver.js';
import { AnthropicDriver } from '../anthropic/anthropic-driver.js';
import { VertexAIDriver } from '../vertexai/vertexai-driver.js';
import { OllamaDriver } from '../ollama/ollama-driver.js';
import { EchoDriver } from '../echo-driver.js';
import { TestDriver } from '../test-driver.js';

import type {
  DriverProvider,
  DriverCapability,
  ModelSpec,
  DriverSelectionCriteria,
  DriverSelectionResult,
  IDriverRegistry,
  DriverFactory
} from './types.js';
import { registerStandardDriverFactories } from './factory-helper.js';

/**
 * ドライバレジストリクラス
 */
export class DriverRegistry implements IDriverRegistry {
  private models: Map<string, ModelSpec> = new Map();
  private factories: Map<DriverProvider, DriverFactory> = new Map();
  private logger: Logger;

  constructor(logLevel: LogLevel = 'info') {
    this.logger = new Logger({
      level: logLevel,
      prefix: 'DriverRegistry'
    });
    // デフォルトのファクトリを登録
    this.registerDefaultFactories();
  }

  /**
   * デフォルトのドライバファクトリを登録
   */
  private registerDefaultFactories(): void {
    // 標準ドライバーを登録
    registerStandardDriverFactories(this, {
      MlxDriver,
      OpenAIDriver,
      AnthropicDriver,
      VertexAIDriver,
      OllamaDriver,
      EchoDriver,
      TestDriver
    });
  }

  /**
   * カスタムファクトリを登録
   */
  registerFactory(provider: DriverProvider, factory: DriverFactory): void {
    this.factories.set(provider, factory);
  }

  /**
   * ファクトリを取得
   */
  getFactory(provider: DriverProvider): DriverFactory | undefined {
    return this.factories.get(provider);
  }


  /**
   * モデルを登録
   */
  registerModel(spec: ModelSpec): void {
    // デフォルト値を設定
    if (spec.priority === undefined) {
      spec.priority = 0;
    }

    const key = `${spec.provider}:${spec.model}`;
    this.models.set(key, spec);
  }


  /**
   * 条件に基づいてモデルを選択
   */
  selectModel(criteria: DriverSelectionCriteria): DriverSelectionResult | null {
    const candidates: DriverSelectionResult[] = [];

    for (const [, spec] of this.models) {
      // 無効なモデルはスキップ
      if (spec.disabled) {
        continue;
      }

      // プロバイダーフィルタ
      if (criteria.providers && !criteria.providers.includes(spec.provider)) {
        continue;
      }
      if (criteria.excludeProviders?.includes(spec.provider)) {
        continue;
      }

      // トークン数チェック
      if (criteria.minInputTokens &&
          spec.maxInputTokens &&
          spec.maxInputTokens < criteria.minInputTokens) {
        continue;
      }
      if (criteria.minOutputTokens &&
          spec.maxOutputTokens &&
          spec.maxOutputTokens < criteria.minOutputTokens) {
        continue;
      }

      // コストチェック
      if (criteria.maxCost) {
        const cost = spec.cost;
        if (cost) {
          if (criteria.maxCost.input && cost.input > criteria.maxCost.input) {
            continue;
          }
          if (criteria.maxCost.output && cost.output > criteria.maxCost.output) {
            continue;
          }
        }
      }

      // 能力チェックとスコア計算
      let score = spec.priority || 0;
      const warnings: string[] = [];
      const capabilities = spec.capabilities;

      // 必須能力チェック
      if (criteria.requiredCapabilities) {
        const missing = criteria.requiredCapabilities.filter(
          cap => !capabilities.includes(cap)
        );
        if (missing.length > 0) {
          continue; // 必須能力が欠けている場合はスキップ
        }
        score += criteria.requiredCapabilities.length * 10;
      }

      // 除外能力チェック
      if (criteria.excludeCapabilities) {
        const hasExcluded = criteria.excludeCapabilities.some(
          cap => capabilities.includes(cap)
        );
        if (hasExcluded) {
          continue;
        }
      }

      // 望ましい能力でスコア調整
      if (criteria.preferredCapabilities) {
        const matched = criteria.preferredCapabilities.filter(
          cap => capabilities.includes(cap)
        );
        score += matched.length * 5;

        const missing = criteria.preferredCapabilities.filter(
          cap => !capabilities.includes(cap)
        );
        if (missing.length > 0) {
          warnings.push(`Missing preferred capabilities: ${missing.join(', ')}`);
        }
      }

      // 特別な優先設定
      if (criteria.preferLocal && capabilities.includes('local')) {
        score += 20;
      }
      if (criteria.preferFast && capabilities.includes('fast')) {
        score += 15;
      }

      // 選択理由を生成
      const reasons: string[] = [];
      if (spec.provider === 'mlx' && criteria.preferLocal) {
        reasons.push('Local execution preferred');
      }
      if (capabilities.includes('fast') && criteria.preferFast) {
        reasons.push('Fast response preferred');
      }
      if (criteria.requiredCapabilities?.length) {
        reasons.push(`Meets all required capabilities: ${criteria.requiredCapabilities.join(', ')}`);
      }
      if (spec.priority && spec.priority > 0) {
        reasons.push(`High priority (${spec.priority})`);
      }

      candidates.push({
        model: spec,
        reason: reasons.join('; ') || 'Default selection',
        score,
        warnings: warnings.length > 0 ? warnings : undefined
      });
    }

    // スコアでソート（降順）
    candidates.sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * モデル仕様からドライバインスタンスを作成
   */
  async createDriver(spec: ModelSpec): Promise<AIDriver> {
    const factory = this.factories.get(spec.provider);
    if (!factory) {
      throw new Error(`No factory registered for provider: ${spec.provider}`);
    }

    return await factory(spec);
  }

  /**
   * 簡易選択メソッド：能力配列から自動選択
   */
  async selectAndCreateDriver(
    capabilities: DriverCapability[],
    options?: {
      preferLocal?: boolean;
      preferFast?: boolean;
      providers?: DriverProvider[];
      excludeProviders?: DriverProvider[];
    }
  ): Promise<AIDriver | null> {
    const criteria: DriverSelectionCriteria = {
      requiredCapabilities: capabilities,
      ...options
    };

    const result = this.selectModel(criteria);
    if (!result) {
      return null;
    }

    // 警告があれば出力
    if (result.warnings) {
      this.logger.warn('Driver selection warnings:', result.warnings);
    }

    this.logger.info(`Selected model: ${result.model.model} (${result.model.provider})`);
    this.logger.debug(`Reason: ${result.reason}`);

    try {
      return await this.createDriver(result.model);
    } catch (error) {
      this.logger.error(`Failed to create driver: ${error}`);
      return null;
    }
  }
}