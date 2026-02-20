/**
 * MLX Driver API v2.0 型定義
 */
import type { MlxMlModelOptions } from '../types.js';
import type { SpecialToken, SpecialTokenPair } from '../../formatter/types.js';

export type { MlxMlModelOptions };

export interface MlxMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// API v2.0 リクエスト型定義
export interface MlxBaseRequest {
  method: 'capabilities' | 'format_test' | 'chat' | 'completion';
}

export interface MlxCapabilitiesRequest extends MlxBaseRequest {
  method: 'capabilities';
}

export interface MlxFormatTestRequest extends MlxBaseRequest {
  method: 'format_test';
  messages: MlxMessage[];
  options?: {
    primer?: string;
  };
}

/** HuggingFace apply_chat_template 互換のtool定義 */
export interface MlxToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface MlxChatRequest extends MlxBaseRequest {
  method: 'chat';
  messages: MlxMessage[];
  primer?: string;
  tools?: MlxToolDefinition[];
  options?: MlxMlModelOptions;
}

export interface MlxCompletionRequest extends MlxBaseRequest {
  method: 'completion';
  prompt: string;
  options?: MlxMlModelOptions;
}

export type MlxRequest = MlxCapabilitiesRequest | MlxFormatTestRequest | MlxChatRequest | MlxCompletionRequest;

export interface ToolCallFormat {
  tool_parser_type?: string;
  call_start?: string;
  call_end?: string;
  response_start?: string;
  response_end?: string;
}

export interface ChatTemplateInfo {
  template_string?: string;
  supported_roles: string[];
  preview?: string;
  constraints: Record<string, unknown>;
  tool_call_format?: ToolCallFormat;
}

/**
 * MLX Runtime Information (from Python process)
 *
 * Pythonプロセスから取得する生の情報（snake_case）
 */
export interface MlxRuntimeInfo {
  methods: string[];
  special_tokens: Record<string, SpecialToken | SpecialTokenPair>;
  features: {
    apply_chat_template: boolean;
    vocab_size?: number;
    model_max_length?: number;
    chat_template?: ChatTemplateInfo;
  };
  chat_restrictions?: {
    single_system_at_start?: boolean;
    max_system_messages?: number;
    alternating_turns?: boolean;
    requires_user_last?: boolean;
    allow_empty_messages?: boolean;
  };
}

export interface MlxFormatTestResult {
  formatted_prompt: string | null;
  template_applied: boolean;
  model_specific_processing: MlxMessage[] | null;
  error: string | null;
}

// レガシー互換性のための型
export interface LegacyMlxRequest {
  messages: MlxMessage[];
  prompt?: string;
  primer?: string;
  options?: MlxMlModelOptions;
}

// 内部用型定義
export interface BaseQueueItem {
  request: MlxRequest | LegacyMlxRequest;
  expectJsonResponse?: boolean;
}

export interface CapabilitiesQueueItem extends BaseQueueItem {
  request: MlxCapabilitiesRequest;
  resolve: (value: MlxRuntimeInfo) => void;
  expectJsonResponse: true;
}

export interface FormatTestQueueItem extends BaseQueueItem {
  request: MlxFormatTestRequest;
  resolve: (value: MlxFormatTestResult) => void;
  expectJsonResponse: true;
}

export interface StreamingQueueItem extends BaseQueueItem {
  request: MlxChatRequest | MlxCompletionRequest | LegacyMlxRequest;
  resolve: (value: Readable) => void;
  expectJsonResponse?: false;
}

export type QueueItem = CapabilitiesQueueItem | FormatTestQueueItem | StreamingQueueItem;

// Node.js stream import
import { Readable } from 'stream';