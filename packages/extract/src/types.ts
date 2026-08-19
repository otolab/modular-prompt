import type { PromptModule, SectionContent } from '@modular-prompt/core';
import type { AIDriver, PromptCacheController, QueryOptions, QueryResult } from '@modular-prompt/driver';

/** Corpus fixed for the session lifetime (materials / messages). */
export interface ExtractCorpus {
  materials?: SectionContent;
  messages?: SectionContent;
}

export interface ExtractSessionOptions<TContext = unknown> {
  driver: AIDriver;
  /** Base prompt for extraction task (objective, instructions, etc.). Defaults to {@link defaultExtractBaseModule}. */
  baseModule?: PromptModule<TContext>;
  /** Immutable document corpus for this session. */
  corpus: ExtractCorpus;
  /** Output schema (Phase 3: structured output). Accepted at session creation. */
  schema?: object;
  /** Cache controller (Phase 2). When set, session orchestrates KV cache lifecycle. */
  cacheController?: PromptCacheController;
  /** Model identifier for cache prepare. Required when cacheController is set. */
  model?: string;
}

export interface ExtractRequest {
  /** Extraction focus for this call (output / cue section). */
  cue: string | SectionContent;
  /** Supplemental data for this call (inputs section). */
  inputs?: Record<string, unknown> | SectionContent;
  options?: QueryOptions;
}

export interface ExtractResult {
  text: string;
  structured?: unknown;
  usage?: QueryResult['usage'];
  /** Zero-based index within this session. */
  index: number;
}

export interface ExtractSession {
  extract(request: ExtractRequest): Promise<ExtractResult>;
  getHistory(): ReadonlyArray<ExtractResult>;
  close(): Promise<void>;
}
