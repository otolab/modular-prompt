/**
 * Simple chat application types
 */

import type { ApplicationConfig, ModelsConfig, ModelsMergeMode } from '@modular-prompt/driver';

/** Workflow mode */
export type WorkflowMode = 'direct' | 'default' | 'agentic';

/** Model reference in workflow */
export interface ModelReference {
  /** models.yaml の alias（`provider`+`model` の代わりに使用可） */
  ref?: string;
  provider?: string;
  model?: string;
  /** MLX 内の実行モード（auto / lm / vlm / optiq） */
  backend?: string;
}

export interface DialogProfile {
  /** Model name to use (CLI -m override) */
  model?: string;
  /** 推論プロバイダー（CLI --provider / profile で指定） */
  provider?: string;
  /** MLX 内の実行モード（CLI --backend / profile で指定） */
  backend?: string;
  /** PromptModule inline definition (objective, instructions, guidelines, etc.) */
  module?: Record<string, any>;
  /** Pre-message from assistant after system prompt */
  preMessage?: string;
  /** Resource files to include in system prompt (relative paths from profile) */
  resourceFiles?: string[];
  /** VLMモデルをtext-onlyモードで使用する */
  textOnly?: boolean;
  /** Speculative decoding用のdrafter model名 */
  drafterModel?: string;
  /** Speculative decoding用のdraft block size */
  draftBlockSize?: number;
  /** KVキャッシュディレクトリ。指定するとプロンプトキャッシュが有効になる */
  cacheDir?: string;
  /** チャットログファイルパス（JSON） */
  logPath?: string;
  /** Options */
  options?: {
    /** Temperature (0.0-2.0) */
    temperature?: number;
    /** Maximum tokens */
    maxTokens?: number;
    /** Top-p setting */
    topP?: number;
    /** Cache strategy: true=read/write, false=disabled, 'read-only'=use existing only */
    cache?: boolean | 'read-only';
  };
  /** Driver provider configurations */
  drivers?: ApplicationConfig['drivers'];
  /** ~/.modular-prompt/models.yaml との統合（overlay は profile 内で明示定義） */
  modelsConfig?: {
    /** models セクションのマージモード（デフォルト: merge） */
    mode?: ModelsMergeMode;
    /** overlay: models / drivers */
    models?: ModelsConfig['models'];
    drivers?: ModelsConfig['drivers'];
  };
  /** Workflow configuration */
  workflow?: {
    /** Execution mode (default: 'direct') */
    mode?: WorkflowMode;
    /** Role-based model assignments */
    models?: Record<string, ModelReference>;
    /** Process-specific options (for default/agentic modes) */
    processOptions?: {
      /** Maximum tasks for agentic mode (default: 10) */
      maxTasks?: number;
      /** Include thinking process in output (default: false) */
      includeThinking?: boolean;
    };
  };
}

export interface ChatLogEntry {
  /** Message role */
  role: 'system' | 'user' | 'assistant';
  /** Message content */
  content: string;
  /** Timestamp */
  timestamp: string;
  /** Resource files used (for user messages) */
  resourceFiles?: string[];
  /** Image file paths (for user messages) */
  images?: string[];
}

export interface ChatLog {
  /** Chat session ID */
  sessionId: string;
  /** Session start time */
  startedAt: string;
  /** Profile used */
  profile: DialogProfile;
  /** Message history */
  messages: ChatLogEntry[];
}

export interface SimpleChatOptions {
  /** Dialog profile file path */
  profilePath?: string;
  /** Chat log file path */
  logPath?: string;
  /** User message from command line */
  userMessage?: string;
  /** Use stdin for input */
  useStdin?: boolean;
  /** Show log only mode */
  showLogOnly?: boolean;
  /** Override model */
  model?: string;
  /** Override temperature */
  temperature?: number;
  /** Override max tokens */
  maxTokens?: number;
  /** Image file paths for VLM */
  images?: string[];
  /** 推論プロバイダー（pytorch 等） */
  provider?: string;
  /** MLX 内の実行モード（auto / lm / vlm / optiq） */
  backend?: string;
  /** VLMモデルをtext-onlyモードで使用する */
  textOnly?: boolean;
  /** Speculative decoding用のdrafter model名 */
  drafterModel?: string;
  /** Speculative decoding用のdraft block size */
  draftBlockSize?: number;
  /** Cache strategy: true=read/write, false=disabled, 'read-only'=use existing only */
  cache?: boolean | 'read-only';
}
