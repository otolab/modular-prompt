import type { GoogleGenAI } from '@google/genai';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import { elementToPart, elementToContent, convertTools } from './element-converter.js';

export interface GoogleGenAICacheControllerConfig {
  ttl?: string;
  displayName?: string;
}

export class GoogleGenAICacheController implements PromptCacheController {
  private managedCaches: string[] = [];

  constructor(
    private client: GoogleGenAI,
    private config?: GoogleGenAICacheControllerConfig
  ) {}

  async prepare(params: CachePrepareParams): Promise<CacheHandle> {
    const cacheConfig: Record<string, unknown> = {
      ttl: this.config?.ttl || '3600s',
      displayName: this.config?.displayName,
    };

    if (params.instructions && params.instructions.length > 0) {
      cacheConfig.systemInstruction = params.instructions.map(el => elementToPart(el));
    }

    if (params.data && params.data.length > 0) {
      cacheConfig.contents = params.data.map(el => elementToContent(el));
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

    const ref = cache.name!;
    this.managedCaches.push(ref);

    return {
      ref,
      includes: {
        instructions: (params.instructions?.length ?? 0) > 0,
        dataElementCount: params.data?.length ?? 0,
        tools: (params.tools?.length ?? 0) > 0,
      },
    };
  }

  async invalidate(handle: CacheHandle): Promise<void> {
    await this.client.caches.delete({ name: handle.ref });
    this.managedCaches = this.managedCaches.filter(n => n !== handle.ref);
  }

  async close(): Promise<void> {
    const deletions = this.managedCaches.map(name =>
      this.client.caches.delete({ name }).catch(() => {})
    );
    await Promise.all(deletions);
    this.managedCaches = [];
  }
}
