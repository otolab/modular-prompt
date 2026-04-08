/**
 * Driver Factory Helper
 * ドライバファクトリの登録を支援するヘルパー関数
 */

import type { DriverRegistry } from './registry.js';
import type { ModelSpec, DriverProvider } from './types.js';
import type { AIDriver } from '../types.js';
import { logger } from '@modular-prompt/utils';

// 個別ドライバーのインポート（型安全性のため）
import type { MlxDriver } from '../mlx-ml/mlx-driver.js';
import type { OpenAIDriver } from '../openai/openai-driver.js';
import type { AnthropicDriver } from '../anthropic/anthropic-driver.js';
import type { VertexAIDriver } from '../vertexai/vertexai-driver.js';
import type { OllamaDriver } from '../ollama/ollama-driver.js';
import type { EchoDriver } from '../echo-driver.js';
import type { TestDriver } from '../test-driver.js';

/**
 * defaultOptionsのmaxTokensをModelSpec.maxOutputTokensで制限
 *
 * @param spec - モデル仕様
 * @param defaultOptions - デフォルトオプション（spec.metadataから取得）
 * @returns 検証・制限されたdefaultOptions
 */
function validateAndClampMaxTokens(
  spec: ModelSpec,
  defaultOptions: any
): any {
  if (!spec.maxOutputTokens || !defaultOptions?.maxTokens) {
    return defaultOptions;
  }

  if (defaultOptions.maxTokens > spec.maxOutputTokens) {
    logger.warn(
      `maxTokens (${defaultOptions.maxTokens}) exceeds model limit ` +
      `(${spec.maxOutputTokens}) for model "${spec.model}". ` +
      `Clamping to ${spec.maxOutputTokens}.`
    );
    return {
      ...defaultOptions,
      maxTokens: spec.maxOutputTokens
    };
  }

  return defaultOptions;
}

/**
 * 標準ドライバーのファクトリー関数を登録
 *
 * 各ドライバーのコンストラクタは異なるシグネチャを持つため、
 * 個別にファクトリー関数を定義して登録する
 */
export function registerStandardDriverFactories(
  registry: DriverRegistry,
  drivers: {
    MlxDriver?: typeof MlxDriver;
    OpenAIDriver?: typeof OpenAIDriver;
    AnthropicDriver?: typeof AnthropicDriver;
    VertexAIDriver?: typeof VertexAIDriver;
    OllamaDriver?: typeof OllamaDriver;
    EchoDriver?: typeof EchoDriver;
    TestDriver?: typeof TestDriver;
  }
): void {
  // MLX Driver
  if (drivers.MlxDriver) {
    const Driver = drivers.MlxDriver;
    // TODO: metadata経由でドライバー固有オプションを渡す仕組みを整理したい
    registry.registerFactory('mlx', (spec: ModelSpec) => {
      return new Driver({
        model: spec.model,
        defaultOptions: validateAndClampMaxTokens(
          spec,
          spec.defaultOptions
        ) as Partial<import('../mlx-ml/types.js').MlxMlModelOptions>,
        textOnly: spec.metadata?.textOnly as boolean | undefined
      });
    });
  }

  // OpenAI Driver
  if (drivers.OpenAIDriver) {
    const Driver = drivers.OpenAIDriver;
    registry.registerFactory('openai', (spec: ModelSpec) => {
      return new Driver({
        apiKey: process.env.OPENAI_API_KEY || '',
        model: spec.model,
        defaultOptions: validateAndClampMaxTokens(
          spec,
          spec.metadata
        ) as Record<string, unknown>
      });
    });
  }

  // Anthropic Driver
  if (drivers.AnthropicDriver) {
    const Driver = drivers.AnthropicDriver;
    registry.registerFactory('anthropic', (spec: ModelSpec) => {
      return new Driver({
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: spec.model,
        defaultOptions: validateAndClampMaxTokens(
          spec,
          spec.metadata
        ) as Record<string, unknown>
      });
    });
  }

  // VertexAI Driver
  if (drivers.VertexAIDriver) {
    const Driver = drivers.VertexAIDriver;
    registry.registerFactory('vertexai', (spec: ModelSpec) => {
      return new Driver({
        project: process.env.VERTEX_AI_PROJECT,
        location: process.env.VERTEX_AI_LOCATION || 'us-central1',
        model: spec.model,
        defaultOptions: validateAndClampMaxTokens(
          spec,
          spec.metadata
        ) as Record<string, unknown>
      });
    });
  }

  // Ollama Driver
  if (drivers.OllamaDriver) {
    const Driver = drivers.OllamaDriver;
    registry.registerFactory('ollama', (spec: ModelSpec) => {
      return new Driver({
        baseURL: 'http://localhost:11434',
        model: spec.model,
        defaultOptions: validateAndClampMaxTokens(
          spec,
          spec.metadata
        ) as Record<string, unknown>
      });
    });
  }

  // Echo Driver (for testing)
  if (drivers.EchoDriver) {
    const Driver = drivers.EchoDriver;
    registry.registerFactory('echo', () => {
      return new Driver({
        format: 'text'
      });
    });
  }

  // Test Driver (for unit testing)
  if (drivers.TestDriver) {
    const Driver = drivers.TestDriver;
    registry.registerFactory('test' as DriverProvider, () => {
      return new Driver({});
    });
  }
}

/**
 * 下位互換性のための旧API
 * @deprecated Use registerStandardDriverFactories instead
 */
export function registerDriverFactories(
  registry: DriverRegistry,
  drivers: Record<string, unknown>
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerStandardDriverFactories(registry, drivers as any);
}

/**
 * 単一のドライバーファクトリーを登録する汎用関数
 *
 * 使用例：
 * ```typescript
 * registerDriverFactory(registry, 'custom', (config) => {
 *   return new CustomDriver({
 *     apiKey: config.credentials?.apiKey,
 *     // ... カスタム設定
 *   });
 * });
 * ```
 */
export function registerDriverFactory(
  registry: DriverRegistry,
  name: string,
  factory: (spec: ModelSpec) => AIDriver
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry.registerFactory(name as any, factory);
}