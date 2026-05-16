import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { unlink, mkdir, rm, writeFile } from 'node:fs/promises';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { MlxProcess } from './process/index.js';
import type { MlxMessage } from './process/index.js';
import { convertMessages } from './mlx-message-utils.js';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'MLX', context: 'cache' });

interface CacheIndexEntry {
  key: string;
  model: string;
  formatterOptionsHash: string;
  elementHashes: string[];
  createdAt: string;
}

interface CacheIndex {
  version: 1;
  entries: CacheIndexEntry[];
}

export interface MlxCacheControllerOptions {
  /** 固定キャッシュディレクトリ。指定時はauto-cleanupが無効になる */
  cacheDir?: string;
}

export class MlxCacheController implements PromptCacheController {
  private cacheByHash = new Map<string, CacheHandle>();
  private inflightRequests = new Map<string, Promise<CacheHandle>>();
  private process?: MlxProcess;
  private cacheDir: string;
  private managedDir: boolean;
  private cacheDirReady = false;
  private closed = false;
  private bound = false;
  private cleanupHandler?: () => void;
  private messageProcessor?: (messages: MlxMessage[]) => MlxMessage[];
  private formatterOptions: FormatterOptions;
  private lastHandle?: CacheHandle;
  private cacheIndex: CacheIndex = { version: 1, entries: [] };
  private indexLoaded = false;

  constructor(options?: MlxCacheControllerOptions) {
    this.formatterOptions = {};
    if (options?.cacheDir) {
      this.cacheDir = options.cacheDir;
      this.managedDir = false;
    } else {
      this.cacheDir = '';
      this.managedDir = true;
    }
  }

  bind(
    process: MlxProcess,
    formatterOptions: FormatterOptions,
    messageProcessor?: (messages: MlxMessage[]) => MlxMessage[],
  ): void {
    if (this.bound) {
      throw new Error('MlxCacheController is already bound to a process');
    }
    this.process = process;
    this.formatterOptions = formatterOptions;
    this.messageProcessor = messageProcessor;
    if (!this.cacheDir) {
      this.cacheDir = join(tmpdir(), `mlx-prompt-cache-${randomBytes(6).toString('hex')}`);
    }
    if (this.managedDir) {
      this.cleanupHandler = () => {
        try { rmSync(this.cacheDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      };
      globalThis.process.on('exit', this.cleanupHandler);
    }
    if (!this.managedDir) {
      this.loadIndexSync();
    }
    this.bound = true;
  }

  private async ensureCacheDir(): Promise<void> {
    if (this.cacheDirReady) return;
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
    this.cacheDirReady = true;
  }

  private get indexPath(): string {
    return join(this.cacheDir, 'cache-index.json');
  }

  private loadIndexSync(): void {
    try {
      if (existsSync(this.indexPath)) {
        const raw = readFileSync(this.indexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
          this.cacheIndex = parsed;
        }
      }
    } catch {
      // corrupt index — start fresh
    }
    this.indexLoaded = true;
  }

  private async saveIndex(): Promise<void> {
    if (this.managedDir) return;
    try {
      await this.ensureCacheDir();
      await writeFile(this.indexPath, JSON.stringify(this.cacheIndex, null, 2));
    } catch {
      // best-effort
    }
  }

  private computeFormatterOptionsHash(): string {
    if (!this.formatterOptions || Object.keys(this.formatterOptions).length === 0) {
      return '';
    }
    return createHash('sha256').update(JSON.stringify(this.formatterOptions)).digest('hex');
  }

  private computeElementHashes(params: CachePrepareParams): string[] {
    const hashes: string[] = [];
    for (const el of params.instructions || []) {
      hashes.push(createHash('sha256').update(JSON.stringify(el)).digest('hex'));
    }
    for (const el of params.data || []) {
      hashes.push(createHash('sha256').update(JSON.stringify(el)).digest('hex'));
    }
    return hashes;
  }

  private findBestBase(params: CachePrepareParams): string | undefined {
    if (this.cacheIndex.entries.length === 0) return undefined;

    const newHashes = this.computeElementHashes(params);
    const fmtHash = this.computeFormatterOptionsHash();
    let bestPath: string | undefined;
    let bestMatchLength = 0;
    const staleKeys: string[] = [];

    for (const entry of this.cacheIndex.entries) {
      if (entry.model !== params.model) {
        logger.debug(`findBestBase: skip ${entry.key.slice(0, 8)} (model mismatch)`);
        continue;
      }
      if (entry.formatterOptionsHash !== fmtHash) {
        logger.debug(`findBestBase: skip ${entry.key.slice(0, 8)} (fmtHash mismatch)`);
        continue;
      }

      const maxLen = Math.min(entry.elementHashes.length, newHashes.length);
      let matchLength = 0;
      for (let i = 0; i < maxLen; i++) {
        if (entry.elementHashes[i] !== newHashes[i]) break;
        matchLength++;
      }

      if (matchLength === 0) {
        logger.debug(`findBestBase: skip ${entry.key.slice(0, 8)} (no prefix match)`);
        continue;
      }

      logger.debug(
        `findBestBase: ${entry.key.slice(0, 8)}`,
        `match ${matchLength}/${entry.elementHashes.length} elements`,
      );

      if (matchLength > bestMatchLength) {
        const path = this.generateCachePath(entry.key);
        if (existsSync(path)) {
          bestPath = path;
          bestMatchLength = matchLength;
        } else {
          staleKeys.push(entry.key);
        }
      }
    }

    if (staleKeys.length > 0) {
      this.cacheIndex.entries = this.cacheIndex.entries.filter(e => !staleKeys.includes(e.key));
    }

    if (bestPath) {
      logger.verbose(`findBestBase: best match ${bestMatchLength}/${newHashes.length} elements`);
    }

    return bestPath;
  }

  private addToIndex(params: CachePrepareParams, cacheKey: string): void {
    // avoid duplicates
    if (this.cacheIndex.entries.some(e => e.key === cacheKey)) return;

    this.cacheIndex.entries.push({
      key: cacheKey,
      model: params.model,
      formatterOptionsHash: this.computeFormatterOptionsHash(),
      elementHashes: this.computeElementHashes(params),
      createdAt: new Date().toISOString(),
    });
  }

  private removeFromIndex(cachePath: string): void {
    const key = cachePath.split('/').pop()?.replace('.safetensors', '');
    if (key) {
      this.cacheIndex.entries = this.cacheIndex.entries.filter(e => e.key !== key);
    }
  }

  private computeCacheKey(params: CachePrepareParams): string {
    const payload: Record<string, unknown> = { model: params.model };
    if (params.instructions && params.instructions.length > 0) {
      payload.instructions = params.instructions;
    }
    if (params.data && params.data.length > 0) {
      payload.data = params.data;
    }
    if (this.formatterOptions && Object.keys(this.formatterOptions).length > 0) {
      payload.formatterOptions = this.formatterOptions;
    }
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private generateCachePath(cacheKey: string): string {
    return join(this.cacheDir, `${cacheKey}.safetensors`);
  }

  async prepare(params: CachePrepareParams): Promise<CacheHandle> {
    if (!this.bound) {
      throw new Error('MlxCacheController is not bound to a process');
    }
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

    const prepareStart = performance.now();
    const promise = this.createCache(params, cacheKey);
    this.inflightRequests.set(cacheKey, promise);
    try {
      const handle = await promise;
      logger.verbose(`prepare total ${(performance.now() - prepareStart).toFixed(0)}ms`,
        cacheKey.slice(0, 12));
      return handle;
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

    const cachePath = this.generateCachePath(cacheKey);

    if (existsSync(cachePath)) {
      logger.verbose('reusing existing cache file', cacheKey.slice(0, 12));
    } else {
      // base cacheの探索: セッション内lastHandle → インデックス探索
      let baseCachePath: string | undefined;
      if (this.lastHandle?.ref && existsSync(this.lastHandle.ref)) {
        baseCachePath = this.lastHandle.ref;
        logger.debug('base cache: lastHandle', baseCachePath.split('/').pop());
      } else {
        logger.debug(
          'base cache: no lastHandle',
          `(ref=${this.lastHandle?.ref ? 'set' : 'none'},`,
          `index=${this.cacheIndex.entries.length} entries)`,
        );
        baseCachePath = this.findBestBase(params);
        if (!baseCachePath) {
          logger.debug('base cache: findBestBase returned nothing');
        }
      }

      if (baseCachePath) {
        logger.verbose('incremental prefill from', baseCachePath.split('/').pop());
      }

      const prefillPrompt: CompiledPrompt = {
        instructions: params.instructions || [],
        data: params.data || [],
        output: [],
      };

      const chatMessages = formatPromptAsMessages(prefillPrompt, this.formatterOptions);
      let mlxMessages = convertMessages(chatMessages);
      if (this.messageProcessor) {
        mlxMessages = this.messageProcessor(mlxMessages);
      }

      logger.debug('prefill', cachePath);
      const prefillStart = performance.now();
      try {
        await this.process!.cachePrefill(cachePath, mlxMessages, baseCachePath);
      } catch (e) {
        logger.verbose('prefill failed, skipping cache:', e instanceof Error ? e.message : String(e));
        return MlxCacheController.EMPTY_HANDLE;
      }
      const prefillMs = performance.now() - prefillStart;
      logger.verbose(`prefill completed in ${prefillMs.toFixed(0)}ms`,
        baseCachePath ? '(incremental)' : '(fresh)');

      if (this.closed) {
        await unlink(cachePath).catch(() => {});
        await unlink(cachePath + '.meta.json').catch(() => {});
        return MlxCacheController.EMPTY_HANDLE;
      }
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
    this.lastHandle = handle;

    this.addToIndex(params, cacheKey);
    await this.saveIndex();

    return handle;
  }

  async invalidate(handle: CacheHandle): Promise<void> {
    logger.debug('invalidate', handle.ref);
    this.removeFromIndex(handle.ref);
    await unlink(handle.ref).catch(() => {});
    await unlink(handle.ref + '.meta.json').catch(() => {});
    for (const [key, entry] of this.cacheByHash) {
      if (entry.ref === handle.ref) {
        this.cacheByHash.delete(key);
        break;
      }
    }
    if (this.lastHandle?.ref === handle.ref) {
      this.lastHandle = undefined;
    }
    await this.saveIndex();
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
    this.lastHandle = undefined;
    if (this.managedDir && this.cacheDir) {
      await rm(this.cacheDir, { recursive: true, force: true }).catch(() => {});
    } else {
      await this.saveIndex();
    }
    this.cacheDirReady = false;
    if (this.cleanupHandler) {
      globalThis.process.removeListener('exit', this.cleanupHandler);
    }
  }
}
