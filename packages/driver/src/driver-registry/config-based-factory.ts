/**
 * Config-based Driver Factory
 * ApplicationConfigを使用したドライバーファクトリー
 *
 * registryパターンで各ドライバーのファクトリーを登録し、
 * createDriverはregistryを通じて動的にドライバーを作成する
 */

import type { DriverRegistry } from './registry.js';
import type { ModelSpec } from './types.js';

// 個別ドライバーのインポート
import { MlxDriver } from '../mlx-ml/mlx-driver.js';
import { OpenAIDriver } from '../openai/openai-driver.js';
import { AnthropicDriver } from '../anthropic/anthropic-driver.js';
import { VertexAIDriver } from '../vertexai/vertexai-driver.js';
import { GoogleGenAIDriver } from '../google-genai/google-genai-driver.js';
import { OllamaDriver } from '../ollama/ollama-driver.js';
import { VllmDriver } from '../vllm/vllm-driver.js';
import { EchoDriver } from '../echo-driver.js';
import { TestDriver } from '../test-driver.js';

/**
 * アプリケーション設定
 * CLI層やアプリケーション層で管理される統一的な設定
 */
export interface ApplicationConfig {
  /** ドライバー設定 */
  drivers?: {
    /** OpenAI API設定 */
    openai?: {
      apiKey?: string;
      baseURL?: string;
      organization?: string;
    };
    /** Anthropic API設定 */
    anthropic?: {
      apiKey?: string;
      baseURL?: string;
      /** VertexAI経由で接続する場合の設定 */
      vertex?: {
        project: string;
        location?: string;
        accessToken?: string;
      };
    };
    /** VertexAI設定 */
    vertexai?: {
      project?: string;
      location?: string;
      region?: string;
    };
    /** GoogleGenAI設定 */
    googlegenai?: {
      apiKey?: string;
    };
    /** MLX設定 */
    mlx?: {
      baseURL?: string;
      pythonPath?: string;
    };
    /** Ollama設定 */
    ollama?: {
      baseURL?: string;
    };
    /** vLLM設定 */
    vllm?: {
      /** Unix ドメインソケットパス（vLLM エンジンが listen しているパス） */
      socketPath?: string;
    };
  };

  /** デフォルトオプション */
  defaultOptions?: {
    mode?: import('../types.js').QueryMode;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
  };

  /** モデル仕様 */
  models?: ModelSpec[];
}


/**
 * ApplicationConfigベースのファクトリーをregistryに登録
 *
 * 各ドライバーのファクトリーがDriverConfigを受け取る形で登録する
 */
export function registerFactories(
  registry: DriverRegistry,
  config: ApplicationConfig
): void {
  /** ApplicationConfig.defaultOptions と ModelSpec.defaultOptions をマージ（spec が優先） */
  const mergeDefaults = (spec: ModelSpec) =>
    spec.defaultOptions
      ? { ...config.defaultOptions, ...spec.defaultOptions }
      : config.defaultOptions;

  // MLX Driver Factory
  registry.registerFactory('mlx', (spec) => {
    return new MlxDriver({
      model: spec.model,
      defaultOptions: mergeDefaults(spec)
    });
  });

  // OpenAI Driver Factory
  registry.registerFactory('openai', (spec) => {
    const openaiConfig = config.drivers?.openai;
    return new OpenAIDriver({
      apiKey: openaiConfig?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: openaiConfig?.baseURL,
      organization: openaiConfig?.organization,
      model: spec.model,
      defaultOptions: mergeDefaults(spec)
    });
  });

  // Anthropic Driver Factory
  registry.registerFactory('anthropic', (spec) => {
    const anthropicConfig = config.drivers?.anthropic;
    return new AnthropicDriver({
      apiKey: anthropicConfig?.apiKey || process.env.ANTHROPIC_API_KEY,
      model: spec.model,
      defaultOptions: mergeDefaults(spec),
      vertex: anthropicConfig?.vertex,
    });
  });

  // VertexAI Driver Factory
  registry.registerFactory('vertexai', (spec) => {
    const vertexConfig = config.drivers?.vertexai;
    return new VertexAIDriver({
      project: vertexConfig?.project || process.env.VERTEX_AI_PROJECT,
      location: vertexConfig?.location || vertexConfig?.region || 'us-central1',
      model: spec.model,
      defaultOptions: mergeDefaults(spec)
    });
  });

  // GoogleGenAI Driver Factory
  registry.registerFactory('googlegenai', (spec) => {
    const googlegenaiConfig = config.drivers?.googlegenai;
    return new GoogleGenAIDriver({
      apiKey: googlegenaiConfig?.apiKey || process.env.GOOGLE_GENAI_API_KEY,
      model: spec.model,
      defaultOptions: mergeDefaults(spec)
    });
  });

  // Ollama Driver Factory
  registry.registerFactory('ollama', (spec) => {
    const ollamaConfig = config.drivers?.ollama;
    return new OllamaDriver({
      baseURL: ollamaConfig?.baseURL || 'http://localhost:11434',
      model: spec.model,
      defaultOptions: mergeDefaults(spec)
    });
  });

  // vLLM Driver Factory
  registry.registerFactory('vllm', (spec) => {
    const vllmConfig = config.drivers?.vllm;
    const socketPath = vllmConfig?.socketPath || `/tmp/vllm-${spec.model.replace(/\//g, '-')}.sock`;
    return new VllmDriver({
      socketPath,
      defaultOptions: mergeDefaults(spec),
    });
  });

  // Echo Driver Factory (for testing)
  registry.registerFactory('echo', () => {
    return new EchoDriver({
      format: 'text'
    });
  });

  // Test Driver Factory (for unit testing)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry.registerFactory('test' as any, () => {
    return new TestDriver({});
  });
}

