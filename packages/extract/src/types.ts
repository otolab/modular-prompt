import type { PromptModule } from '@modular-prompt/core';
import type { AIDriver, PromptCacheController, QueryOptions, QueryResult } from '@modular-prompt/driver';
import type { ExtractContext } from './extract-context.js';
import type {
  InputsInput,
  MaterialsInput,
  MessagesInput,
} from './extract-elements.js';
import type { SectionContent } from '@modular-prompt/core';

/** Corpus fixed for the session lifetime (materials / messages). */
export interface ExtractCorpus {
  /** 抽出対象資料（title + content が最低限）。 */
  materials?: MaterialsInput;
  /** 対話ログ（role + content が最低限）。 */
  messages?: MessagesInput;
}

export interface ExtractSessionOptions<TContext = ExtractContext> {
  driver: AIDriver;
  /** KV cache controller shared with the driver. */
  cacheController: PromptCacheController;
  /** Model identifier for cache prepare (must match the driver). */
  model: string;
  /**
   * Base prompt for extraction task.
   * 省略時は {@link defaultExtractBaseModule} を使用する。
   */
  baseModule?: PromptModule<TContext>;
  /**
   * Domain-specific overlay (terms, additional instructions).
   * Merged on top of baseModule (or default).
   */
  domainModule?: PromptModule<TContext>;
  /** Immutable document corpus for this session. */
  corpus: ExtractCorpus;
  /** Output schema (Phase 3: structured output). Accepted at session creation. */
  schema?: object;
}

export interface ExtractRequest {
  /** Extraction focus for this call (output / cue section). */
  cue: string | SectionContent;
  /** 補強情報（content が最低限。文字列は content の省略記法）。 */
  inputs?: InputsInput;
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
