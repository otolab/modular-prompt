import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { unlink, mkdir, rm } from 'node:fs/promises';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { MlxProcess } from './process/index.js';
import { convertMessages } from './mlx-message-utils.js';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'MLX', context: 'cache' });

export class MlxCacheController implements PromptCacheController {
  private cacheByHash = new Map<string, CacheHandle>();
  private inflightRequests = new Map<string, Promise<CacheHandle>>();
  private cacheDir: string;
  private cacheDirReady = false;
  private closed = false;
  private cleanupHandler: () => void;

  constructor(
    private process: MlxProcess,
    private formatterOptions: FormatterOptions = {},
  ) {
    this.cacheDir = join(tmpdir(), `mlx-prompt-cache-${randomBytes(6).toString('hex')}`);
    this.cleanupHandler = () => {
      try { rmSync(this.cacheDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    };
    globalThis.process.on('exit', this.cleanupHandler);
  }

  private async ensureCacheDir(): Promise<void> {
    if (this.cacheDirReady) return;
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
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
    return join(this.cacheDir, `${cacheKey}.safetensors`);
  }

  async prepare(params: CachePrepareParams): Promise<CacheHandle> {
    if (params.tools && params.tools.length > 0) {
      throw new Error('MlxCacheController does not support tool-aware caching');
    }

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

  private static readonly EMPTY_HANDLE: CacheHandle = {
    ref: '', includes: { instructions: false, dataElementCount: 0, tools: false }
  };

  private async createCache(params: CachePrepareParams, cacheKey: string): Promise<CacheHandle> {
    try {
      await this.ensureCacheDir();
    } catch (e) {
      logger.verbose('cache dir creation failed, skipping cache:', e instanceof Error ? e.message : String(e));
      return MlxCacheController.EMPTY_HANDLE;
    }

    const prefillPrompt: CompiledPrompt = {
      instructions: params.instructions || [],
      data: params.data || [],
      output: [],
    };

    const chatMessages = formatPromptAsMessages(prefillPrompt, this.formatterOptions);
    const mlxMessages = convertMessages(chatMessages);

    const cachePath = this.generateCachePath(cacheKey);
    logger.debug('prefill', cachePath);
    try {
      await this.process.cachePrefill(cachePath, mlxMessages);
    } catch (e) {
      logger.verbose('prefill failed, skipping cache:', e instanceof Error ? e.message : String(e));
      return MlxCacheController.EMPTY_HANDLE;
    }

    if (this.closed) {
      await unlink(cachePath).catch(() => {});
      return MlxCacheController.EMPTY_HANDLE;
    }

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
    this.closed = true;
    logger.debug('close', `entries=${this.cacheByHash.size}`);
    const timeout = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 30_000);
      timer.unref();
    });
    await Promise.race([
      Promise.allSettled([...this.inflightRequests.values()]),
      timeout,
    ]);
    this.inflightRequests.clear();
    this.cacheByHash.clear();
    await rm(this.cacheDir, { recursive: true, force: true }).catch(() => {});
    this.cacheDirReady = false;
    globalThis.process.removeListener('exit', this.cleanupHandler);
  }
}
