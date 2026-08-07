/**
 * Local Inference Protocol — モジュール集約
 *
 * `@modular-prompt/driver` の公開 API は主に `InferenceProcessClient`。
 * 以下の通信層・キュー型はパッケージ内部向け（テスト・将来の PyTorch バックエンド用）。
 */

export type {
  InferenceMethod,
  InferenceContentPart,
  InferenceStandardMessage,
  InferenceAssistantToolCallMessage,
  InferenceToolResultMessage,
  InferenceMessage,
  InferenceToolDefinition,
  InferenceSamplingOptions,
  InferenceBaseRequest,
  InferenceCapabilitiesRequest,
  InferenceFormatTestRequest,
  InferenceTokenizeRequest,
  InferenceChatRequest,
  InferenceCompletionRequest,
  InferenceGenerateRequest,
  InferenceCachePrefillRequest,
  InferenceCachePrefillResult,
  InferenceRequest,
  KnownToolParserType,
  ToolCallFormat,
  ChatTemplateInfo,
  InferenceCapabilities,
  InferenceFormatTestResult,
  InferenceTokenizeResult,
} from './protocol.js';

/** @internal キュー実装の内部型 */
export type {
  LegacyStreamingRequest,
  BaseQueueItem,
  CapabilitiesQueueItem,
  FormatTestQueueItem,
  TokenizeQueueItem,
  CachePrefillQueueItem,
  StreamingQueueItem,
  QueueItem,
} from './queue-types.js';

/** @internal stdio 通信（InferenceProcessClient から利用） */
export {
  ProcessCommunication,
  type ProcessCommunicationCallbacks,
  type ProcessCommunicationConfig,
} from './process-communication.js';

/** @internal JSON-RPC リクエストキュー */
export {
  InferenceRequestQueue,
  type RequestQueueCallbacks,
  type SamplingOptionsMapper,
} from './request-queue.js';

/** バックエンド非依存の LIP プロセスクライアント（公開 API） */
export {
  InferenceProcessClient,
  type InferenceProcessClientConfig,
} from './process-client.js';
