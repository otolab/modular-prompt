import type { Element } from '@modular-prompt/core';
import type { ToolDefinition } from './types.js';

export interface CachePrepareParams {
  model: string;
  instructions?: Element[];
  data?: Element[];
  tools?: ToolDefinition[];
}

export interface CacheHandle {
  ref: string;
  includes: {
    instructions: boolean;
    dataElementCount: number;
    tools: boolean;
  };
}

export interface PromptCacheController {
  prepare(params: CachePrepareParams): Promise<CacheHandle>;
  invalidate(handle: CacheHandle): Promise<void>;
  close(): Promise<void>;
}
