import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink, mkdir, rm } from 'node:fs/promises';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { MlxProcess } from './process/index.js';
import type { MlxMessage } from './process/types.js';
import { convertMessages } from './mlx-driver.js';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'MLX', context: 'cache' });

export interface MlxCacheControllerConfig {
  chatProcessor?: (messages: MlxMessage[]) => MlxMessage[];
}

export class MlxCacheController implements PromptCacheController {
  private cacheByHash = new Map<string, CacheHandle>();
  private inflightRequests = new Map<string, Promise<CacheHandle>>();
  private cacheDir: string;
  private cacheDirReady = false;

  constructor(
    private process: MlxProcess,
    private formatterOptions: FormatterOptions = {},
    private config?: MlxCacheControllerConfig
  ) {
    this.cacheDir = join(tmpdir(), `mlx-prompt-cache-${randomBytes(6).toString('hex')}`);
  }

  private async ensureCacheDir(): Promise<void> {
    if (this.cacheDirReady) return;
    await mkdir(this.cacheDir, { recursive: true });
    this.cacheDirReady = true;
  }

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

  private generateCachePath(cacheKey: string): string {
    return join(this.cacheDir, `${cacheKey.slice(0, 16)}.safetensors`);
  }

  async prepare(params: CachePrepareParams): Promise<CacheHandle> {
    const hasContent =
      (params.instructions?.length ?? 0) > 0 ||
      (params.data?.length ?? 0) > 0;
    if (!hasContent) {
      throw new Error('Cannot prepare cache with no cacheable content');
    }

    const cacheKey = this.computeCacheKey(params);

    const existing = this.cacheByHash.get(cacheKey);
    if (existing) {
      logger.verbose('cache hit', cacheKey.slice(0, 12));
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
    await this.ensureCacheDir();

    const prefillPrompt: CompiledPrompt = {
      instructions: params.instructions || [],
      data: params.data || [],
      output: [],
    };

    const chatMessages = formatPromptAsMessages(prefillPrompt, this.formatterOptions);
    let mlxMessages = convertMessages(chatMessages);

    if (this.config?.chatProcessor) {
      mlxMessages = this.config.chatProcessor(mlxMessages);
    }

    const cachePath = this.generateCachePath(cacheKey);
    logger.debug('prefill', cachePath);
    await this.process.cachePrefill(cachePath, mlxMessages);

    const handle: CacheHandle = {
      ref: cachePath,
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
    logger.debug('invalidate', handle.ref);
    await unlink(handle.ref).catch(() => {});
    for (const [key, entry] of this.cacheByHash) {
      if (entry.ref === handle.ref) {
        this.cacheByHash.delete(key);
        break;
      }
    }
  }

  async close(): Promise<void> {
    logger.debug('close', `entries=${this.cacheByHash.size}`);
    await Promise.allSettled([...this.inflightRequests.values()]);
    this.inflightRequests.clear();
    this.cacheByHash.clear();
    await rm(this.cacheDir, { recursive: true, force: true }).catch(() => {});
    this.cacheDirReady = false;
  }
}
