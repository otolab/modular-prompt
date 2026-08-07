/**
 * MLX Driver API v2.0 型定義
 *
 * LIP 共通型は local-inference から re-export し、
 * Mlx* 名前で後方互換を維持する。
 */
import type { MlxMlModelOptions } from '../types.js';
import type {
  InferenceBaseRequest,
  InferenceCapabilitiesRequest,
  InferenceFormatTestRequest,
  InferenceTokenizeRequest,
  InferenceChatRequest,
  InferenceCompletionRequest,
  InferenceGenerateRequest,
  InferenceCachePrefillRequest,
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

export type {
  LegacyStreamingRequest as LegacyMlxRequest,
  BaseQueueItem,
  CapabilitiesQueueItem,
  FormatTestQueueItem,
  TokenizeQueueItem,
  CachePrefillQueueItem,
  StreamingQueueItem,
  QueueItem,
} from '../../local-inference/queue-types.js';

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

/** MLX ドライバー向け generate リクエスト */
export interface MlxGenerateRequest extends Omit<InferenceGenerateRequest, 'options'> {
  method: 'generate';
  options?: MlxMlModelOptions;
}

export type MlxRequest =
  | InferenceCapabilitiesRequest
  | InferenceFormatTestRequest
  | InferenceTokenizeRequest
  | MlxChatRequest
  | MlxCompletionRequest
  | MlxGenerateRequest
  | InferenceCachePrefillRequest;
