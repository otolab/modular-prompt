/**
 * AIService - capability駆動のドライバ作成サービス
 */

import type { DriverRegistry } from './registry.js';
import type { ModelSpec, DriverCapability, DriverProvider } from './types.js';
import type { AIDriver } from '../types.js';
import type { ApplicationConfig } from './config-based-factory.js';
import { registerFactories } from './config-based-factory.js';
import { DriverRegistry as DriverRegistryImpl } from './registry.js';

/**
 * モデル選択オプション
 */
export interface SelectionOptions {
  /** ローカル実行を優先 */
  preferLocal?: boolean;

  /** 特定のプロバイダーを優先 */
  preferProvider?: DriverProvider;

  /** 除外するプロバイダー */
  excludeProviders?: DriverProvider[];

  /** 高速応答を優先 */
  preferFast?: boolean;

  /** 条件緩和モード（条件を満たさない場合は条件を減らして再試行） */
  lenient?: boolean;
}

/**
 * AIサービスクラス
 * レジストリを管理し、capabilityベースでドライバを作成
 */
export class AIService {
  private registry: DriverRegistry;
  private config: ApplicationConfig;

  constructor(config: ApplicationConfig) {
    this.config = config;
    this.registry = new DriverRegistryImpl();
    registerFactories(this.registry, config);
  }

  /**
   * capabilityからドライバを作成
   */
  async createDriverFromCapabilities(
    capabilities: DriverCapability[],
    options?: SelectionOptions
  ): Promise<AIDriver | null> {
    const models = this.selectModels(capabilities, options);
    if (!models.length) return null;

    // 最適なモデルを選択してドライバを作成
    return this.registry.createDriver(models[0]);
  }

  /**
   * モデル仕様から直接ドライバを作成
   */
  async createDriver(spec: ModelSpec): Promise<AIDriver> {
    return this.registry.createDriver(spec);
  }

  /**
   * モデル選択
   */
  selectModels(
    capabilities: DriverCapability[],
    options?: SelectionOptions
  ): ModelSpec[] {
    // disabled + capability フィルタ
    let models = this.config.models?.filter(m =>
      !m.disabled && capabilities.every(cap => m.capabilities.includes(cap))
    ) || [];

    // プロバイダー除外
    if (options?.excludeProviders) {
      models = models.filter(m =>
        !options.excludeProviders!.includes(m.provider)
      );
    }

    // lenient モード：条件を満たすモデルがない場合は条件を緩和
    if (options?.lenient && models.length === 0 && capabilities.length > 0) {
      return this.selectModels(capabilities.slice(0, -1), options);
    }

    // ソート
    models.sort((a, b) => {
      // 特定プロバイダー優先
      if (options?.preferProvider) {
        if (a.provider === options.preferProvider) return -1;
        if (b.provider === options.preferProvider) return 1;
      }

      // ローカル優先
      if (options?.preferLocal) {
        const aLocal = a.capabilities.includes('local');
        const bLocal = b.capabilities.includes('local');
        if (aLocal !== bLocal) return aLocal ? -1 : 1;
      }

      // 高速優先
      if (options?.preferFast) {
        const aFast = a.capabilities.includes('fast');
        const bFast = b.capabilities.includes('fast');
        if (aFast !== bFast) return aFast ? -1 : 1;
      }

      // 優先度
      return (b.priority || 0) - (a.priority || 0);
    });

    return models;
  }
}