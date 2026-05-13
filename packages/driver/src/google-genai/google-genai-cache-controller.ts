import { createHash } from 'node:crypto';
import type { GoogleGenAI } from '@google/genai';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import { elementToPart, elementToContent, convertTools, mergeToolResultContents } from './element-converter.js';

export interface GoogleGenAICacheControllerConfig {
  ttl?: string;
  displayName?: string;
}

export class GoogleGenAICacheController implements PromptCacheController {
  private managedCaches: string[] = [];
  private cacheByHash = new Map<string, CacheHandle>();
  private inflightRequests = new Map<string, Promise<CacheHandle>>();

  constructor(
    private client: GoogleGenAI,
    private config?: GoogleGenAICacheControllerConfig
  ) {}

  private computeCacheKey(params: CachePrepareParams): string {
    const payload = {
      model: params.model,
      instructions: params.instructions,
      data: params.data,
      tools: params.tools,
    };
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
    const cacheConfig: Record<string, unknown> = {
      ttl: this.config?.ttl || '3600s',
      displayName: this.config?.displayName,
    };

    if (params.instructions && params.instructions.length > 0) {
      cacheConfig.systemInstruction = params.instructions.map(el => elementToPart(el));
    }

    if (params.data && params.data.length > 0) {
      cacheConfig.contents = mergeToolResultContents(params.data.map(el => elementToContent(el)));
    }

    if (params.tools && params.tools.length > 0) {
      cacheConfig.tools = convertTools(params.tools);
    }

    Object.keys(cacheConfig).forEach(key => {
      if (cacheConfig[key] === undefined) {
        delete cacheConfig[key];
      }
    });

    const cache = await this.client.caches.create({
      model: params.model,
      config: cacheConfig,
    });

    if (!cache.name) {
      throw new Error('GoogleGenAI caches.create() returned a cache without a name');
    }
    const ref = cache.name;
    this.managedCaches.push(ref);

    const handle: CacheHandle = {
      ref,
      includes: {
        instructions: (params.instructions?.length ?? 0) > 0,
        dataElementCount: params.data?.length ?? 0,
        tools: (params.tools?.length ?? 0) > 0,
      },
    };
    this.cacheByHash.set(cacheKey, handle);

    return handle;
  }

  async invalidate(handle: CacheHandle): Promise<void> {
    await this.client.caches.delete({ name: handle.ref });
    this.managedCaches = this.managedCaches.filter(n => n !== handle.ref);
    for (const [key, cached] of this.cacheByHash) {
      if (cached.ref === handle.ref) {
        this.cacheByHash.delete(key);
        break;
      }
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.inflightRequests.values()]).catch(() => {});
    this.inflightRequests.clear();
    const deletions = this.managedCaches.map(name =>
      this.client.caches.delete({ name }).catch(() => {})
    );
    await Promise.all(deletions);
    this.managedCaches = [];
    this.cacheByHash.clear();
  }
}
