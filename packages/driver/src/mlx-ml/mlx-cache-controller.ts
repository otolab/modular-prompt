import { createHash } from 'node:crypto';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { MlxProcess } from './process/index.js';
import { convertMessages } from './mlx-driver.js';

export class MlxCacheController implements PromptCacheController {
  private cacheByHash = new Map<string, CacheHandle>();
  private inflightRequests = new Map<string, Promise<CacheHandle>>();

  constructor(
    private process: MlxProcess,
    private formatterOptions: FormatterOptions = {}
  ) {}

  private computeCacheKey(params: CachePrepareParams): string {
    const payload: Record<string, unknown> = { model: params.model };
    if (params.instructions && params.instructions.length > 0) {
      payload.instructions = params.instructions;
    }
    if (params.data && params.data.length > 0) {
      payload.data = params.data;
    }
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  async prepare(params: CachePrepareParams): Promise<CacheHandle> {
    const cacheKey = this.computeCacheKey(params);

    const existing = this.cacheByHash.get(cacheKey);
    if (existing) {
      return existing;
    }

    const inflight = this.inflightRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const promise = this.createCache(params, cacheKey);
    this.inflightRequests.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflightRequests.delete(cacheKey);
    }
  }

  private async createCache(params: CachePrepareParams, cacheKey: string): Promise<CacheHandle> {
    const prefillPrompt: CompiledPrompt = {
      instructions: params.instructions || [],
      data: params.data || [],
      output: [],
    };

    const chatMessages = formatPromptAsMessages(prefillPrompt, this.formatterOptions);
    const mlxMessages = convertMessages(chatMessages);

    const cacheId = `mlx-cache-${cacheKey.slice(0, 16)}`;
    await this.process.cachePrefill(cacheId, mlxMessages);

    const handle: CacheHandle = {
      ref: cacheId,
      includes: {
        instructions: (params.instructions?.length ?? 0) > 0,
        dataElementCount: params.data?.length ?? 0,
        tools: false,
      },
    };
    this.cacheByHash.set(cacheKey, handle);
    return handle;
  }

  async invalidate(handle: CacheHandle): Promise<void> {
    await this.process.cacheDelete(handle.ref);
    for (const [key, entry] of this.cacheByHash) {
      if (entry.ref === handle.ref) {
        this.cacheByHash.delete(key);
        break;
      }
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.inflightRequests.values()]);
    this.inflightRequests.clear();
    const refs = [...new Set([...this.cacheByHash.values()].map(h => h.ref))];
    await Promise.all(refs.map(ref => this.process.cacheDelete(ref).catch(() => {})));
    this.cacheByHash.clear();
  }
}
