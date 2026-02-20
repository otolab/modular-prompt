/**
 * MLX Driver Public Types
 *
 * 外部に公開する型定義
 */

import type { SpecialToken, SpecialTokenPair } from '../formatter/types.js';
import type { ChatRestrictions, ApiStrategy } from './model-spec/index.js';

/**
 * MLX message format
 */
export interface MlxMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * MLX model options (キャメルケース形式)
 * Python側へはmapOptionsToPythonで変換される
 */
export interface MlxMlModelOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  repetitionContextSize?: number;
  // Allow string indexing for dynamic parameter access
  [key: string]: number | undefined;
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
  templateString?: string;
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
