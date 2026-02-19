/**
 * Driver Registry Types
 * ドライバレジストリシステムの型定義
 */

import type { AIDriver } from '../types.js';

/**
 * ドライバプロバイダータイプ
 */
export type DriverProvider =
  | 'openai'
  | 'anthropic'
  | 'vertexai'
  | 'googlegenai'
  | 'mlx'
  | 'ollama'
  | 'echo'  // テスト用
  | 'test'; // ユニットテスト用

/**
 * ドライバ能力フラグ
 * 各ドライバが持つ機能や特性を表す
 */
export type DriverCapability = 
  | 'streaming'      // ストリーミング応答対応
  | 'local'          // ローカル実行可能
  | 'fast'           // 高速応答
  | 'large-context'  // 大規模コンテキスト対応
  | 'multilingual'   // 多言語対応
  | 'japanese'       // 日本語特化
  | 'coding'         // コーディング特化
  | 'reasoning'      // 推論・思考特化
  | 'chat'           // チャット特化
  | 'tools'          // ツール使用可能
  | 'vision'         // 画像認識可能
  | 'audio'          // 音声処理可能
  | 'structured'     // 構造化出力対応
  | 'json'           // JSON出力対応
  | 'function-calling'; // 関数呼び出し対応

/**
 * モデル仕様（code-bugsのModelSpecと同等）
 */
export interface ModelSpec {
  /** モデル識別子（プロバイダ内でユニーク） */
  model: string;

  /** プロバイダー名 */
  provider: DriverProvider;

  /** モデルの能力フラグ */
  capabilities: DriverCapability[];

  /** 最大入力トークン数 */
  maxInputTokens?: number;

  /** 最大出力トークン数 */
  maxOutputTokens?: number;

  /** 合計最大トークン数（入力＋出力） */
  maxTotalTokens?: number;

  /** 分あたりのトークン制限 (TPM: Tokens Per Minute) */
  tokensPerMinute?: number;

  /** 分あたりのリクエスト制限 (RPM: Requests Per Minute) */
  requestsPerMinute?: number;

  /** コスト情報（1Kトークンあたりのドル） */
  cost?: {
    input: number;   // 入力トークンのコスト
    output: number;  // 出力トークンのコスト
  };

  /** 優先度（高いほど優先される） */
  priority?: number;

  /** このモデルを無効化する */
  disabled?: boolean;

  /** カスタムメタデータ */
  metadata?: Record<string, unknown>;
}

/**
 * ドライバファクトリ関数の型
 * ModelSpecを直接受け取ってドライバを作成
 */
export type DriverFactory = (spec: ModelSpec) => AIDriver | Promise<AIDriver>;


/**
 * ドライバ選択条件
 */
export interface DriverSelectionCriteria {
  /** 必要な能力（すべて満たす必要がある） */
  requiredCapabilities?: DriverCapability[];
  
  /** 望ましい能力（いくつか満たせばよい） */
  preferredCapabilities?: DriverCapability[];
  
  /** 除外する能力（これらを持つドライバは選択しない） */
  excludeCapabilities?: DriverCapability[];
  
  /** 最小入力トークン数 */
  minInputTokens?: number;
  
  /** 最小出力トークン数 */
  minOutputTokens?: number;
  
  /** 最大コスト（1Kトークンあたり） */
  maxCost?: {
    input?: number;
    output?: number;
  };
  
  /** 特定のプロバイダーに限定 */
  providers?: DriverProvider[];
  
  /** 特定のプロバイダーを除外 */
  excludeProviders?: DriverProvider[];
  
  /** ローカル実行を優先 */
  preferLocal?: boolean;
  
  /** 速度を優先 */
  preferFast?: boolean;
}

/**
 * モデル選択結果
 */
export interface DriverSelectionResult {
  /** 選択されたモデル仕様 */
  model: ModelSpec;

  /** 選択理由 */
  reason: string;

  /** スコア（適合度） */
  score: number;

  /** 警告メッセージ */
  warnings?: string[];
}


/**
 * ドライバレジストリインターフェース
 */
export interface IDriverRegistry {
  /** モデルを登録 */
  registerModel(spec: ModelSpec): void;
  
  /** 条件に基づいてモデルを選択 */
  selectModel(criteria: DriverSelectionCriteria): DriverSelectionResult | null;

  /** モデル仕様からドライバインスタンスを作成 */
  createDriver(spec: ModelSpec): Promise<AIDriver>;

  /** ファクトリーを登録 */
  registerFactory(provider: DriverProvider, factory: DriverFactory): void;

  /** ファクトリーを取得 */
  getFactory(provider: DriverProvider): DriverFactory | undefined;
}