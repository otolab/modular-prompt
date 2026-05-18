import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { unlink, mkdir, rm, writeFile } from 'node:fs/promises';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import type { ToolDefinition } from '../types.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { MlxProcess } from './process/index.js';
import type { MlxMessage } from './process/index.js';
import { convertMessages, convertToolDefinitions } from './mlx-message-utils.js';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'MLX', context: 'cache' });

interface CacheIndexEntry {
  key: string;
  model: string;
  formatterOptionsHash: string;
  elementHashes: string[];
  toolsHash?: string;
  reasoningEffort?: string;
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

interface BaseCacheInfo {
  path: string;
  trimTokens?: number;
  /** base cacheが新プロンプトの全要素をカバーしているか */
  coversAll: boolean;
  /** base cacheファイルが実際に保持している要素ハッシュ */
  sourceElementHashes: string[];
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
  private lastElementHashes?: string[];
  private lastHandleModel?: string;
  private lastHandleFormatterOptionsHash?: string;
  private lastHandleToolsHash?: string;
  private lastHandleReasoningEffort?: string;
  private cacheIndex: CacheIndex = { version: 1, entries: [] };
  private indexLoaded = false;
  private stats = {
    totalQueries: 0,
    memoryHit: 0, diskHit: 0, incremental: 0, fresh: 0,
    prefillTokens: 0,
    prefillReusedTokens: 0,
    totalPromptTokens: 0,
    totalCacheTokensUsed: 0,
  };

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

  private readMetaTokenCount(cachePath: string): number {
    try {
      const raw = readFileSync(cachePath + '.meta.json', 'utf-8');
      const meta = JSON.parse(raw);
      return typeof meta.token_count === 'number' ? meta.token_count : 0;
    } catch {
      return 0;
    }
  }

  private readElementOffsets(cachePath: string): number[] | undefined {
    try {
      const raw = readFileSync(cachePath + '.meta.json', 'utf-8');
      const meta = JSON.parse(raw);
      return Array.isArray(meta.element_offsets) ? meta.element_offsets : undefined;
    } catch {
      return undefined;
    }
  }

  private computeElementCharOffsets(
    params: CachePrepareParams,
    preMergeMessages: MlxMessage[],
  ): number[] {
    const boundaryIndices = new Set<number>();
    let msgIdx = 0;
    if (this.formatterOptions.preamble) msgIdx++;
    const instLen = params.instructions?.length ?? 0;
    const dataLen = params.data?.length ?? 0;
    if (instLen > 0) {
      msgIdx++;
      for (let i = 0; i < instLen; i++) boundaryIndices.add(msgIdx++);
    }
    if (dataLen > 0) {
      msgIdx++;
      for (let i = 0; i < dataLen; i++) boundaryIndices.add(msgIdx++);
    }

    if (boundaryIndices.size === 0) return [];

    const offsets: number[] = [];
    let cumLen = 0;
    let systemCount = 0;

    for (let i = 0; i < preMergeMessages.length; i++) {
      const msg = preMergeMessages[i];
      if (msg.role !== 'system') {
        if (boundaryIndices.has(i)) return [];
        continue;
      }

      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else {
        content = (msg.content as Array<{ type: string; text?: string }>)
          .filter(p => p.type === 'text')
          .map(p => p.text ?? '')
          .join('\n');
      }

      if (systemCount > 0) cumLen += 2;
      cumLen += content.length;
      systemCount++;

      if (boundaryIndices.has(i)) {
        offsets.push(cumLen);
      }
    }

    return offsets;
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

  private computeToolsHash(tools?: ToolDefinition[]): string {
    if (!tools || tools.length === 0) return '';
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  }

  private updateLastCache(handle: CacheHandle, elementHashes: string[], params: CachePrepareParams): void {
    this.lastHandle = handle;
    this.lastElementHashes = elementHashes;
    this.lastHandleModel = params.model;
    this.lastHandleFormatterOptionsHash = this.computeFormatterOptionsHash();
    this.lastHandleToolsHash = this.computeToolsHash(params.tools);
    this.lastHandleReasoningEffort = params.reasoningEffort ?? '';
  }

  private clearLastCache(): void {
    this.lastHandle = undefined;
    this.lastElementHashes = undefined;
    this.lastHandleModel = undefined;
    this.lastHandleFormatterOptionsHash = undefined;
    this.lastHandleToolsHash = undefined;
    this.lastHandleReasoningEffort = undefined;
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

  private findBestBase(params: CachePrepareParams): BaseCacheInfo | undefined {
    const newHashes = this.computeElementHashes(params);
    if (newHashes.length === 0) return undefined;

    const fmtHash = this.computeFormatterOptionsHash();
    const newToolsHash = this.computeToolsHash(params.tools);

    interface Candidate {
      path: string;
      elementHashes: string[];
      label: string;
    }
    const candidates: Candidate[] = [];
    const staleKeys: string[] = [];

    for (const entry of this.cacheIndex.entries) {
      if (entry.model !== params.model || entry.formatterOptionsHash !== fmtHash) continue;
      if ((entry.toolsHash ?? '') !== newToolsHash) continue;
      if ((entry.reasoningEffort ?? '') !== (params.reasoningEffort ?? '')) continue;
      const path = this.generateCachePath(entry.key);
      if (existsSync(path)) {
        candidates.push({ path, elementHashes: entry.elementHashes, label: entry.key.slice(0, 8) });
      } else {
        staleKeys.push(entry.key);
      }
    }

    if (this.lastHandle?.ref && this.lastElementHashes && existsSync(this.lastHandle.ref)) {
      const lastCompatible =
        this.lastHandleModel === params.model &&
        this.lastHandleFormatterOptionsHash === fmtHash &&
        (this.lastHandleToolsHash ?? '') === newToolsHash &&
        (this.lastHandleReasoningEffort ?? '') === (params.reasoningEffort ?? '');
      if (lastCompatible && !candidates.some(c => c.path === this.lastHandle!.ref)) {
        candidates.push({
          path: this.lastHandle.ref,
          elementHashes: this.lastElementHashes,
          label: 'lastHandle',
        });
      }
    }

    if (staleKeys.length > 0) {
      this.cacheIndex.entries = this.cacheIndex.entries.filter(e => !staleKeys.includes(e.key));
    }

    if (candidates.length === 0) return undefined;

    let bestMatchLength = 0;
    let bestInfo: BaseCacheInfo | undefined;

    for (const c of candidates) {
      const maxLen = Math.min(c.elementHashes.length, newHashes.length);
      let matchLength = 0;
      for (let i = 0; i < maxLen; i++) {
        if (c.elementHashes[i] !== newHashes[i]) break;
        matchLength++;
      }

      if (matchLength === 0) continue;

      let info: BaseCacheInfo;

      if (matchLength === c.elementHashes.length) {
        // entry is a prefix of (or equal to) new — no trim needed
        info = { path: c.path, coversAll: matchLength >= newHashes.length, sourceElementHashes: c.elementHashes };
      } else {
        // entry has extra/different elements — need trim via element_offsets
        const offsets = this.readElementOffsets(c.path);
        if (!offsets || offsets.length < matchLength) {
          logger.debug(`findBestBase: skip ${c.label} (partial ${matchLength}/${c.elementHashes.length}, no offsets)`);
          continue;
        }
        info = {
          path: c.path,
          trimTokens: offsets[matchLength - 1],
          coversAll: matchLength >= newHashes.length,
          sourceElementHashes: c.elementHashes,
        };
      }

      if (matchLength > bestMatchLength) {
        bestMatchLength = matchLength;
        bestInfo = info;
      }
    }

    if (bestInfo) {
      logger.verbose(
        `findBestBase: ${bestMatchLength}/${newHashes.length} elements`,
        bestInfo.trimTokens != null ? `(trim to ${bestInfo.trimTokens} tokens)` : '',
        bestInfo.coversAll ? '(covers all)' : '',
      );
    }

    return bestInfo;
  }

  private addToIndex(params: CachePrepareParams, cacheKey: string): void {
    // avoid duplicates
    if (this.cacheIndex.entries.some(e => e.key === cacheKey)) return;

    this.cacheIndex.entries.push({
      key: cacheKey,
      model: params.model,
      formatterOptionsHash: this.computeFormatterOptionsHash(),
      elementHashes: this.computeElementHashes(params),
      toolsHash: this.computeToolsHash(params.tools),
      reasoningEffort: params.reasoningEffort,
      createdAt: new Date().toISOString(),
    });
  }

  private removeFromIndex(cachePath: string): void {
    const key = basename(cachePath, '.safetensors');
    this.cacheIndex.entries = this.cacheIndex.entries.filter(e => e.key !== key);
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
    if (params.tools && params.tools.length > 0) {
      payload.tools = [...params.tools].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (params.reasoningEffort) {
      payload.reasoningEffort = params.reasoningEffort;
    }
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private generateCachePath(cacheKey: string): string {
    return join(this.cacheDir, `${cacheKey}.safetensors`);
  }

  recordQuery(): void {
    this.stats.totalQueries++;
  }

  recordPromptTokens(promptTokens: number, cacheTokensUsed: number): void {
    this.stats.totalPromptTokens += promptTokens;
    this.stats.totalCacheTokensUsed += cacheTokensUsed;
  }

  readCacheTokenCount(cachePath: string): number {
    return this.readMetaTokenCount(cachePath);
  }

  getStats() {
    const s = this.stats;
    return {
      totalQueries: s.totalQueries,
      cached: s.memoryHit + s.diskHit + s.incremental + s.fresh,
      memoryHit: s.memoryHit, diskHit: s.diskHit,
      incremental: s.incremental, fresh: s.fresh,
      prefillTokens: s.prefillTokens,
      prefillReusedTokens: s.prefillReusedTokens,
      totalPromptTokens: s.totalPromptTokens,
      totalCacheTokensUsed: s.totalCacheTokensUsed,
    };
  }

  async prepare(params: CachePrepareParams): Promise<CacheHandle> {
    if (!this.bound) {
      throw new Error('MlxCacheController is not bound to a process');
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
      this.stats.memoryHit++;
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
    const elementHashes = this.computeElementHashes(params);

    if (existsSync(cachePath)) {
      this.stats.diskHit++;
      logger.verbose('reusing existing cache file', cacheKey.slice(0, 12));
    } else {
      const base = this.findBestBase(params);

      if (base?.coversAll) {
        this.stats.diskHit++;
        logger.verbose('superset reuse', base.path.split('/').pop(),
          base.trimTokens != null ? `(trim to ${base.trimTokens})` : '');

        const handle: CacheHandle = {
          ref: base.path,
          trimTokens: base.trimTokens,
          includes: {
            instructions: (params.instructions?.length ?? 0) > 0,
            dataElementCount: params.data?.length ?? 0,
            tools: false,
          },
        };
        this.cacheByHash.set(cacheKey, handle);
        this.updateLastCache(handle, base.sourceElementHashes, params);
        return handle;
      }

      if (base) {
        logger.verbose('incremental prefill from', base.path.split('/').pop(),
          base.trimTokens != null ? `(trim to ${base.trimTokens})` : '');
      }

      const prefillPrompt: CompiledPrompt = {
        instructions: params.instructions || [],
        data: params.data || [],
        output: [],
      };

      const chatMessages = formatPromptAsMessages(prefillPrompt, this.formatterOptions);
      const preMergeMessages = convertMessages(chatMessages);
      let mlxMessages = preMergeMessages;
      if (this.messageProcessor) {
        mlxMessages = this.messageProcessor(mlxMessages);
      }

      const hasTools = params.tools && params.tools.length > 0;
      const elementCharOffsets = hasTools ? [] : this.computeElementCharOffsets(params, preMergeMessages);
      const mlxTools = hasTools ? convertToolDefinitions(params.tools!) : undefined;

      logger.debug('prefill', cachePath);
      const prefillStart = performance.now();
      try {
        await this.process!.cachePrefill(
          cachePath, mlxMessages,
          base?.path, base?.trimTokens,
          elementCharOffsets,
          mlxTools,
          params.reasoningEffort,
        );
      } catch (e) {
        logger.verbose('prefill failed, skipping cache:', e instanceof Error ? e.message : String(e));
        return MlxCacheController.EMPTY_HANDLE;
      }
      const prefillMs = performance.now() - prefillStart;
      const newTokens = this.readMetaTokenCount(cachePath);
      this.stats.prefillTokens += newTokens;
      if (base) {
        this.stats.incremental++;
        this.stats.prefillReusedTokens += base.trimTokens ?? this.readMetaTokenCount(base.path);
      } else {
        this.stats.fresh++;
      }
      logger.verbose(`prefill ${prefillMs.toFixed(0)}ms`,
        base ? '(incremental)' : '(fresh)');

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
        tools: (params.tools?.length ?? 0) > 0,
      },
    };
    this.cacheByHash.set(cacheKey, handle);
    this.updateLastCache(handle, elementHashes, params);

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
      this.clearLastCache();
    }
    await this.saveIndex();
  }

  async close(): Promise<void> {
    this.closed = true;
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
    this.clearLastCache();
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
