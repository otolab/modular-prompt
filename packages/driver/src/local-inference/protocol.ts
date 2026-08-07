/**
 * Local Inference Protocol (LIP) 型定義
 *
 * Thin Python 推論型ドライバ（MLX / PyTorch 等）が共有する stdio JSON-RPC プロトコル。
 * Python プロセスからの応答は snake_case のまま受け取る。
 */
import type { SpecialToken, SpecialTokenPair } from '../formatter/types.js';

/** LIP で利用可能な JSON-RPC メソッド */
export type InferenceMethod =
  | 'capabilities'
  | 'format_test'
  | 'render'
  | 'chat'
  | 'completion'
  | 'generate'
  | 'cache_prefill'
  | 'tokenize';

/** VLM content part for structured message content */
export type InferenceContentPart =
  | { type: 'text'; text: string }
  | { type: 'image' };

/** 標準メッセージ（system / user / assistant） */
export interface InferenceStandardMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | InferenceContentPart[];
}

/** tool_calls 付き assistant メッセージ（HuggingFace 互換形式） */
export interface InferenceAssistantToolCallMessage {
  role: 'assistant';
  content: string;
  tool_calls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/** tool result メッセージ（HuggingFace 互換形式） */
export interface InferenceToolResultMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
  name: string;
}

export type InferenceMessage =
  | InferenceStandardMessage
  | InferenceAssistantToolCallMessage
  | InferenceToolResultMessage;

/** HuggingFace apply_chat_template 互換の tool 定義 */
export interface InferenceToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** サンプリング等の推論オプション（バックエンド共通の最小集合） */
export interface InferenceSamplingOptions {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  repetition_context_size?: number;
  trust_remote_code?: boolean;
}

export interface InferenceBaseRequest {
  method: InferenceMethod;
}

export interface InferenceCapabilitiesRequest extends InferenceBaseRequest {
  method: 'capabilities';
}

export interface InferenceFormatTestRequest extends InferenceBaseRequest {
  method: 'format_test';
  messages: InferenceMessage[];
  options?: {
    primer?: string;
  };
}

export interface InferenceTokenizeRequest extends InferenceBaseRequest {
  method: 'tokenize';
  messages: InferenceMessage[];
  tools?: InferenceToolDefinition[];
  reasoning_effort?: 'low' | 'medium' | 'high';
}

export interface InferenceRenderRequest extends InferenceBaseRequest {
  method: 'render';
  messages: InferenceMessage[];
  options?: InferenceSamplingOptions & {
    primer?: string;
  };
  tools?: InferenceToolDefinition[];
  reasoning_effort?: 'low' | 'medium' | 'high';
}

/** @deprecated Python chat ハンドラ廃止。render + generate を使用すること。 */
export interface InferenceChatRequest extends InferenceBaseRequest {
  method: 'chat';
  messages: InferenceMessage[];
  primer?: string;
  tools?: InferenceToolDefinition[];
  options?: InferenceSamplingOptions;
  images?: string[];
  maxImageSize?: number;
  reasoning_effort?: 'low' | 'medium' | 'high';
  cache_path?: string;
  cache_trim_tokens?: number;
}

export interface InferenceRenderResult {
  formatted_prompt: string | null;
  error: string | null;
}

export interface InferenceCompletionRequest extends InferenceBaseRequest {
  method: 'completion';
  prompt: string;
  options?: InferenceSamplingOptions;
  images?: string[];
  maxImageSize?: number;
}

/** 整形済み prompt（文字列 or トークン ID）のストリーム推論 */
export interface InferenceGenerateRequest extends InferenceBaseRequest {
  method: 'generate';
  prompt: string | number[];
  primer?: string;
  options?: InferenceSamplingOptions;
  images?: string[];
  maxImageSize?: number;
  cache_path?: string;
  cache_trim_tokens?: number;
}

export interface InferenceCachePrefillRequest extends InferenceBaseRequest {
  method: 'cache_prefill';
  cache_path: string;
  messages: InferenceMessage[];
  base_cache_path?: string;
  trim_to_tokens?: number;
  prefix_offsets?: number[];
  prefix_hashes?: string[];
  tools?: InferenceToolDefinition[];
  reasoning_effort?: 'low' | 'medium' | 'high';
}

export interface InferenceCachePrefillResult {
  cache_path: string;
  token_count?: number;
  prefix_offsets?: number[];
  prefix_hashes?: string[];
}

export type InferenceRequest =
  | InferenceCapabilitiesRequest
  | InferenceFormatTestRequest
  | InferenceRenderRequest
  | InferenceTokenizeRequest
  | InferenceChatRequest
  | InferenceCompletionRequest
  | InferenceGenerateRequest
  | InferenceCachePrefillRequest;

/** MLX-LM が認識する tool_parser_type（capabilities 経由で参照）。
 * 現時点では MLX 固有の知識。PyTorch バックエンド追加時（#302 Phase 6）に
 * バックエンド固有モジュールへ移動・一般化する可能性あり。 */
export type KnownToolParserType =
  | 'json_tools'
  | 'pythonic'
  | 'function_gemma'
  | 'mistral'
  | 'kimi_k2'
  | 'longcat'
  | 'glm47'
  | 'qwen3_coder'
  | 'minimax_m2'
  | 'gemma4'
  | 'harmony';

export interface ToolCallFormat {
  tool_parser_type?: string;
  call_start?: string;
  call_end?: string;
  response_start?: string;
  response_end?: string;
}

export interface ChatTemplateInfo {
  supported_roles: string[];
  preview?: string;
  constraints: Record<string, unknown>;
  tool_call_format?: ToolCallFormat;
}

/**
 * Python プロセスから取得するランタイム能力情報（snake_case）
 */
export interface InferenceCapabilities {
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
  model_kind?: 'lm' | 'vlm';
}

export interface InferenceFormatTestResult {
  formatted_prompt: string | null;
  template_applied: boolean;
  model_specific_processing: InferenceMessage[] | null;
  error: string | null;
}

export interface InferenceTokenizeResult {
  token_ids: number[] | null;
  token_count: number;
  error: string | null;
}
