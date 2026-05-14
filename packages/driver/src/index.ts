// Types
export type {
  AIDriver,
  ChatMessage,
  StandardChatMessage,
  AssistantToolCallMessage,
  ToolResultMessage,
  QueryResult,
  QueryOptions,
  QueryMode,
  DriverConfig,
  Role,
  ToolDefinition,
  ToolChoice,
  ToolCall,
  FinishReason
} from './types.js';

export { hasToolCalls, isToolResult } from './types.js';

// Cache utilities
export type {
  PromptCacheController,
  CachePrepareParams,
  CacheHandle
} from './cache-controller.js';

export {
  isElementCacheable,
  partitionPrompt,
  type PromptPartition
} from './cache-utils.js';

// Query Logger
export { QueryLogger } from './query-logger.js';

// Test driver
export {
  TestDriver,
  type TestDriverOptions,
  type ResponseProvider
} from './test-driver.js';

// Echo driver
export {
  EchoDriver,
  type EchoDriverConfig
} from './echo-driver.js';

// OpenAI driver
export {
  OpenAIDriver,
  type OpenAIDriverConfig,
  type OpenAIQueryOptions
} from './openai/openai-driver.js';

// Ollama driver
export {
  OllamaDriver,
  type OllamaDriverConfig
} from './ollama/ollama-driver.js';

// vLLM driver
export {
  VllmDriver,
  type VllmDriverConfig
} from './vllm/vllm-driver.js';

export {
  VllmProcess
} from './vllm/vllm-process.js';

// Anthropic driver
export {
  AnthropicDriver,
  type AnthropicDriverConfig,
  type AnthropicVertexConfig,
  type AnthropicQueryOptions
} from './anthropic/anthropic-driver.js';

// MLX ML driver
export {
  MlxDriver,
  type MlxDriverConfig
} from './mlx-ml/mlx-driver.js';

// MLX ML low-level process API
export {
  MlxProcess
} from './mlx-ml/process/index.js';

export {
  MlxCacheController,
} from './mlx-ml/mlx-cache-controller.js';

export type {
  MlxMessage,
  MlxContentPart
} from './mlx-ml/types.js';

// VertexAI driver
export {
  VertexAIDriver,
  type VertexAIDriverConfig,
  type VertexAIQueryOptions
} from './vertexai/vertexai-driver.js';

// GoogleGenAI driver
export {
  GoogleGenAIDriver,
  type GoogleGenAIDriverConfig,
  type GoogleGenAIQueryOptions
} from './google-genai/google-genai-driver.js';

export {
  GoogleGenAICacheController,
  type GoogleGenAICacheControllerConfig
} from './google-genai/google-genai-cache-controller.js';

// Formatter exports (moved from utils to avoid circular dependency)
export type {
  FormatterOptions,
  ElementFormatter
} from './formatter/types.js';

export {
  DefaultFormatter
} from './formatter/formatter.js';

export {
  formatPromptAsMessages,
  formatCompletionPrompt,
  defaultFormatterTexts,
  ECHO_SPECIAL_TOKENS
} from './formatter/converter.js';

// Driver Registry and AI Service exports
export {
  AIService,
  DriverRegistry,
  registerFactories,
  type SelectionOptions,
  type ApplicationConfig
} from './driver-registry/index.js';

export type {
  DriverProvider,
  DriverCapability,
  ModelSpec,
  DriverFactory
} from './driver-registry/index.js';