/**
 * MLX Driver Public Types
 *
 * 外部に公開する型定義
 */

import type { SpecialToken, SpecialTokenPair } from '../formatter/types.js';
import type { ChatRestrictions, ApiStrategy } from './model-spec/index.js';

/**
 * VLM content part for structured message content
 */
export type MlxContentPart =
  | { type: 'text'; text: string }
  | { type: 'image' };

/**
 * 標準メッセージ（system / user / assistant）
 */
export interface MlxStandardMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MlxContentPart[];
}

/**
 * tool_calls付きassistantメッセージ（HuggingFace互換形式）
 */
export interface MlxAssistantToolCallMessage {
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

/**
 * tool resultメッセージ（HuggingFace互換形式）
 */
export interface MlxToolResultMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
  name: string;
}

/**
 * MLX message format（Union型）
 */
export type MlxMessage = MlxStandardMessage | MlxAssistantToolCallMessage | MlxToolResultMessage;

/**
 * MLX model options (キャメルケース形式)
 * Python側へはmapOptionsToPythonで変換される
 */
export interface MlxMlModelOptions {
  mode?: import('../types.js').QueryMode;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  repetitionContextSize?: number;
}

// Re-export from model-spec
export type { ChatRestrictions, ApiStrategy };

/**
 * ツール呼び出しフォーマット
 */
export interface ToolCallFormat {
  toolParserType?: string;
  callStart?: string;
  callEnd?: string;
  responseStart?: string;
  responseEnd?: string;
}

/**
 * チャットテンプレート情報
 */
export interface ChatTemplateInfo {
  supportedRoles: string[];
  preview?: string;
  constraints: Record<string, unknown>;
  toolCallFormat?: ToolCallFormat;
}

/**
 * モデルの機能情報
 */
export interface ModelFeatures {
  /** チャットテンプレートを持っているか */
  hasChatTemplate: boolean;

  /** 語彙サイズ */
  vocabSize?: number;

  /** モデルの最大長 */
  modelMaxLength?: number;

  /** チャットテンプレート情報 */
  chatTemplate?: ChatTemplateInfo;
}

/**
 * MLXモデルの能力情報（公開API用）
 *
 * Pythonプロセスから取得した情報をcamelCaseに変換したもの
 */
export interface MlxModelCapabilities {
  /** 利用可能なメソッド一覧 */
  methods: string[];

  /** 特殊トークン */
  specialTokens: Record<string, SpecialToken | SpecialTokenPair>;

  /** モデルの機能 */
  features: ModelFeatures;

  /** チャットの制約（Pythonから取得 + 静的知識） */
  chatRestrictions?: ChatRestrictions;
}
