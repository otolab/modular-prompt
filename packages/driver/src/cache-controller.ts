import type { Element } from '@modular-prompt/core';
import type { ToolDefinition } from './types.js';

export interface CachePrepareParams {
  model: string;
  instructions?: Element[];
  data?: Element[];
  tools?: ToolDefinition[];
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface CacheHandle {
  ref: string;
  /** If set, trim the KV cache to this many tokens after loading */
  trimTokens?: number;
  /** What the cache contains. Drivers use these flags to avoid sending duplicate content. */
  includes: {
    instructions: boolean;
    dataElementCount: number;
    tools: boolean;
  };
}

export interface PromptCacheController {
  /** Record that a query was issued (regardless of cache usage) */
  recordQuery(): void;
  prepare(params: CachePrepareParams): Promise<CacheHandle>;
  invalidate(handle: CacheHandle): Promise<void>;
  close(): Promise<void>;
}
