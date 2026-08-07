import { Readable } from 'stream';
import type {
  InferenceCapabilities,
  InferenceCapabilitiesRequest,
  InferenceFormatTestRequest,
  InferenceFormatTestResult,
  InferenceTokenizeRequest,
  InferenceTokenizeResult,
  InferenceChatRequest,
  InferenceCompletionRequest,
  InferenceCachePrefillRequest,
  InferenceCachePrefillResult,
  InferenceMessage,
  InferenceRequest,
  InferenceSamplingOptions,
} from './protocol.js';

/** 旧プロトコル互換のストリーミングリクエスト形状 */
export interface LegacyStreamingRequest {
  messages: InferenceMessage[];
  prompt?: string;
  primer?: string;
  options?: InferenceSamplingOptions | Record<string, unknown>;
}

export interface BaseQueueItem {
  request: InferenceRequest | LegacyStreamingRequest;
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
  request: InferenceChatRequest | InferenceCompletionRequest | LegacyStreamingRequest;
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
