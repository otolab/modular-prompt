/**
 * MLX Driver API v2.0 型定義
 *
 * LIP 共通型は local-inference/protocol から re-export し、
 * Mlx* 名前で後方互換を維持する。
 */
import { Readable } from 'stream';
import type { MlxMlModelOptions } from '../types.js';
import type {
  InferenceBaseRequest,
  InferenceCapabilities,
  InferenceCapabilitiesRequest,
  InferenceFormatTestRequest,
  InferenceTokenizeRequest,
  InferenceChatRequest,
  InferenceCompletionRequest,
  InferenceCachePrefillRequest,
  InferenceCachePrefillResult,
  InferenceFormatTestResult,
  InferenceTokenizeResult,
  InferenceMessage,
} from '../../local-inference/protocol.js';

export type { MlxMlModelOptions };

export type {
  InferenceContentPart as MlxContentPart,
  InferenceStandardMessage as MlxStandardMessage,
  InferenceAssistantToolCallMessage as MlxAssistantToolCallMessage,
  InferenceToolResultMessage as MlxToolResultMessage,
  InferenceMessage as MlxMessage,
  InferenceToolDefinition as MlxToolDefinition,
  InferenceCapabilitiesRequest as MlxCapabilitiesRequest,
  InferenceFormatTestRequest as MlxFormatTestRequest,
  InferenceTokenizeRequest as MlxTokenizeRequest,
  InferenceCachePrefillRequest as MlxCachePrefillRequest,
  InferenceCachePrefillResult as MlxCachePrefillResult,
  KnownToolParserType,
  ToolCallFormat,
  ChatTemplateInfo,
  InferenceCapabilities as MlxRuntimeInfo,
  InferenceFormatTestResult as MlxFormatTestResult,
  InferenceTokenizeResult as MlxTokenizeResult,
} from '../../local-inference/protocol.js';

export type MlxBaseRequest = InferenceBaseRequest;

/** MLX ドライバー向け chat リクエスト（options は camelCase の MlxMlModelOptions） */
export interface MlxChatRequest extends Omit<InferenceChatRequest, 'options'> {
  method: 'chat';
  options?: MlxMlModelOptions;
}

/** MLX ドライバー向け completion リクエスト */
export interface MlxCompletionRequest extends Omit<InferenceCompletionRequest, 'options'> {
  method: 'completion';
  options?: MlxMlModelOptions;
}

export type MlxRequest =
  | InferenceCapabilitiesRequest
  | InferenceFormatTestRequest
  | InferenceTokenizeRequest
  | MlxChatRequest
  | MlxCompletionRequest
  | InferenceCachePrefillRequest;

// レガシー互換性のための型
export interface LegacyMlxRequest {
  messages: InferenceMessage[];
  prompt?: string;
  primer?: string;
  options?: MlxMlModelOptions;
}

// 内部用型定義
export interface BaseQueueItem {
  request: MlxRequest | LegacyMlxRequest;
  expectJsonResponse?: boolean;
  reject?: (reason: Error) => void;
}

export interface CapabilitiesQueueItem extends BaseQueueItem {
  request: InferenceCapabilitiesRequest;
  resolve: (value: InferenceCapabilities) => void;
  reject: (reason: Error) => void;
  expectJsonResponse: true;
}

export interface FormatTestQueueItem extends BaseQueueItem {
  request: InferenceFormatTestRequest;
  resolve: (value: InferenceFormatTestResult) => void;
  reject: (reason: Error) => void;
  expectJsonResponse: true;
}

export interface TokenizeQueueItem extends BaseQueueItem {
  request: InferenceTokenizeRequest;
  resolve: (value: InferenceTokenizeResult) => void;
  reject: (reason: Error) => void;
  expectJsonResponse: true;
}

export interface CachePrefillQueueItem extends BaseQueueItem {
  request: InferenceCachePrefillRequest;
  resolve: (value: InferenceCachePrefillResult) => void;
  reject: (reason: Error) => void;
  expectJsonResponse: true;
}

export interface StreamingQueueItem extends BaseQueueItem {
  request: MlxChatRequest | MlxCompletionRequest | LegacyMlxRequest;
  resolve: (value: Readable) => void;
  reject: (reason: Error) => void;
  expectJsonResponse?: false;
}

export type QueueItem =
  | CapabilitiesQueueItem
  | FormatTestQueueItem
  | TokenizeQueueItem
  | CachePrefillQueueItem
  | StreamingQueueItem;
