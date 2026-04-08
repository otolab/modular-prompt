/**
 * Simple chat application types
 */

export interface DialogProfile {
  /** Model name to use (optional, uses default if not specified) */
  model?: string;
  /** System prompt */
  systemPrompt: string;
  /** Pre-message from assistant after system prompt */
  preMessage?: string;
  /** Resource files to include in system prompt (relative paths from profile) */
  resourceFiles?: string[];
  /** VLMモデルをtext-onlyモードで使用する */
  textOnly?: boolean;
  /** Options */
  options?: {
    /** Temperature (0.0-2.0) */
    temperature?: number;
    /** Maximum tokens */
    maxTokens?: number;
    /** Top-p setting */
    topP?: number;
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
  /** Drivers configuration file path */
  driversPath?: string;
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
  /** VLMモデルをtext-onlyモードで使用する */
  textOnly?: boolean;
}