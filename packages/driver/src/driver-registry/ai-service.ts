/**
 * AIService - capability駆動のドライバ作成サービス
 */

import type { DriverRegistry } from './registry.js';
import type { ModelSpec, DriverCapability, DriverProvider } from './types.js';
import type { AIDriver } from '../types.js';
import type { ApplicationConfig } from './config-based-factory.js';
import { registerFactories } from './config-based-factory.js';
import { DriverRegistry as DriverRegistryImpl } from './registry.js';
import {
  resolveModelsConfig,
  toApplicationConfig,
  type ModelsConfig,
  type ModelsConfigOptions,
} from '../models-config/index.js';

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

export interface AIServiceModelsOptions extends ModelsConfigOptions {
  /** ApplicationConfig.defaultOptions にマージする追加オプション */
  defaultOptions?: ApplicationConfig['defaultOptions'];
}

/**
 * AIサービスクラス
 * レジストリを管理し、capabilityベースでドライバを作成
 */
export class AIService {
  private registry: DriverRegistry;
  private config: ApplicationConfig;
  readonly modelsConfig: ModelsConfig;

  constructor(config: ApplicationConfig, modelsConfig: ModelsConfig = {}) {
    this.config = config;
    this.modelsConfig = modelsConfig;
    this.registry = new DriverRegistryImpl();
    registerFactories(this.registry, config);
  }

  /**
   * ApplicationConfig から直接作成（experiment 等）
   */
  static fromApplicationConfig(config: ApplicationConfig): AIService {
    return new AIService(config);
  }

  /**
   * models.yaml 解決経由で作成
   */
  static fromModelsConfig(options?: AIServiceModelsOptions): AIService {
    const resolved = resolveModelsConfig(options);
    const appConfig = toApplicationConfig(resolved);

    if (options?.defaultOptions) {
      appConfig.defaultOptions = {
        ...appConfig.defaultOptions,
        ...options.defaultOptions,
      };
    }

    return new AIService(appConfig, resolved);
  }

  /**
   * user models.yaml を無視し、渡した config のみで作成
   */
  static fromOverlay(
    overlay: ModelsConfig,
    options?: Omit<AIServiceModelsOptions, 'overlay' | 'source'>
  ): AIService {
    return AIService.fromModelsConfig({
      ...options,
      source: 'overlay',
      overlay,
    });
  }

  /**
   * base + overlay をマージし、必要なら user yaml も取り込む
   */
  static fromMergedConfig(
    base: ModelsConfig,
    overlay?: ModelsConfig,
    options?: Omit<AIServiceModelsOptions, 'base' | 'overlay'>
  ): AIService {
    return AIService.fromModelsConfig({
      ...options,
      base,
      overlay,
    });
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
    let models = this.config.models?.filter(m =>
      !m.disabled && capabilities.every(cap => m.capabilities.includes(cap))
    ) || [];

    if (options?.excludeProviders) {
      models = models.filter(m =>
        !options.excludeProviders!.includes(m.provider)
      );
    }

    if (options?.lenient && models.length === 0 && capabilities.length > 0) {
      return this.selectModels(capabilities.slice(0, -1), options);
    }

    models.sort((a, b) => {
      if (options?.preferProvider) {
        if (a.provider === options.preferProvider) return -1;
        if (b.provider === options.preferProvider) return 1;
      }

      if (options?.preferLocal) {
        const aLocal = a.capabilities.includes('local');
        const bLocal = b.capabilities.includes('local');
        if (aLocal !== bLocal) return aLocal ? -1 : 1;
      }

      if (options?.preferFast) {
        const aFast = a.capabilities.includes('fast');
        const bFast = b.capabilities.includes('fast');
        if (aFast !== bFast) return aFast ? -1 : 1;
      }

      return (b.priority || 0) - (a.priority || 0);
    });

    return models;
  }
}
