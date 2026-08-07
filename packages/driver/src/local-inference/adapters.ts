import type { CompiledPrompt } from '@modular-prompt/core';
import type { ChatMessage, FormatterOptions } from '../formatter/types.js';
import type { ToolCall, ToolDefinition, ApiStrategy, QueryMode } from '../types.js';
import type {
  InferenceCapabilities,
  InferenceMessage,
  InferenceToolDefinition,
  ToolCallFormat,
} from './protocol.js';
import type { InferenceProcessPort } from './process-port.js';

export interface InferenceModelProcessor {
  applyChatSpecificProcessing(messages: InferenceMessage[]): InferenceMessage[];
  applyCompletionSpecificProcessing(prompt: string): string;
  hasCompletionProcessor(): boolean;
  hasChatProcessor(): boolean;
  setRuntimeContext(context: {
    chatRestrictions?: InferenceCapabilities['chat_restrictions'];
    modelKind?: 'lm' | 'vlm';
  }): void;
}

export interface InferenceResponseParseResult {
  content: string;
  thinkingContent?: string;
  toolCalls?: ToolCall[];
}

export type InferenceResponseProcessor = (content: string) => InferenceResponseParseResult;

export interface LocalInferenceAdapters {
  mergeQueryOptions(
    defaults: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Record<string, unknown>;
  toSamplingOptions(merged: Record<string, unknown>): Record<string, unknown>;
  createModelProcessor(model: string): InferenceModelProcessor;
  selectResponseProcessor(
    model: string,
    runtimeInfo: InferenceCapabilities | null,
    options: { enableToolParsing: boolean },
  ): InferenceResponseProcessor;
  convertToolDefinitions(tools: ToolDefinition[]): InferenceToolDefinition[];
  convertMessages(messages: ChatMessage[], vlm: boolean): InferenceMessage[];
  extractImagePaths(content: string | unknown): string[];
  formatToolDefinitionsAsText(
    tools: ToolDefinition[],
    specialTokens: InferenceCapabilities['special_tokens'] | undefined,
    toolCallFormat?: ToolCallFormat,
  ): string;
  generateMergedPrompt(
    messages: InferenceMessage[],
    specialTokens: InferenceCapabilities['special_tokens'],
  ): string;
  selectApi(
    strategy: ApiStrategy,
    mode: QueryMode | undefined,
    hasChatTemplate: boolean,
    hasCompletionProc: boolean,
  ): 'chat' | 'completion';
}

export interface CachePrepareParams {
  model: string;
  instructions: CompiledPrompt['instructions'];
  data: CompiledPrompt['data'];
  tools?: ToolDefinition[];
  reasoningEffort?: 'low' | 'medium' | 'high';
  readOnly?: boolean;
}

export interface CachePrepareHandle {
  ref?: string;
  trimTokens?: number;
}

export interface LocalInferenceCacheSupport {
  bind(
    process: InferenceProcessPort,
    formatterOptions: FormatterOptions,
    preprocess: (messages: InferenceMessage[]) => InferenceMessage[],
  ): Promise<void>;
  shouldDisableForVlm(modelKind?: 'lm' | 'vlm'): boolean;
  recordQuery(): void;
  getGrowthBefore(): number;
  getWriteTokensSince(growthBefore: number): number;
  prepare(params: CachePrepareParams): Promise<CachePrepareHandle>;
  readTokenCount(cachePath: string): number;
  recordPromptTokens(promptTokens: number, cacheTokensUsed: number): void;
  /** 終了時の統計ログ（オプション。MlxDriver は独自ログを使用） */
  logStats(): void;
  close(): Promise<void>;
}

export interface CapabilitiesLoadedContext {
  formatterOptions: FormatterOptions;
  modelProcessor: InferenceModelProcessor;
  process: InferenceProcessPort;
}
