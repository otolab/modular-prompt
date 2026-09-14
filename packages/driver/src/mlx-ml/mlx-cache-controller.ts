import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { unlink, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { lock as lockFile } from 'proper-lockfile';
import type { PromptCacheController, CachePrepareParams, CacheHandle } from '../cache-controller.js';
import type { ToolDefinition } from '../types.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { MlxProcess, MlxToolDefinition } from './process/index.js';
import type { MlxMessage } from './process/index.js';
import { convertMessages, convertToolDefinitions } from './mlx-message-utils.js';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'MLX', context: 'cache' });
const CACHE_FILE_EXTENSIONS = {
  lm: '.safetensors.zip',
  // mlx-vlm's exact_cache_v1 snapshot is a standalone safetensors file and
  // must never be mistaken for an mlx-lm archive.
  vlm: '.vlm.safetensors',
} as const;

interface CacheIndexEntry {
  key: string;
  model: string;
  formatterOptionsHash: string;
  elementHashes: string[];
  toolsHash?: string;
  reasoningEffort?: string;
  createdAt: string;
  hint?: 'retain' | 'release';
  /** Backend-specific cache format. Missing means the legacy LM format. */
  backend?: 'lm' | 'vlm';
  /** VLM APC snapshot path relative to cacheDir (handles use the absolute path). */
  path?: string;
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
  private modelKind: 'lm' | 'vlm' = 'lm';
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
  /** Token counts returned by the backend, including VLM exact disk refs. */
  private cacheTokenCounts = new Map<string, number>();
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
      // Keep backend refs and relative index paths stable when callers pass a
      // relative cacheDir (the Python process may have a different cwd).
      this.cacheDir = resolvePath(options.cacheDir);
      this.managedDir = false;
    } else {
      this.cacheDir = '';
      this.managedDir = true;
    }
  }

  /** Select backend-local storage before the controller is bound. */
  setModelKind(modelKind?: 'lm' | 'vlm'): void {
    if (this.bound) {
      throw new Error('MlxCacheController model kind must be set before bind');
    }
    this.modelKind = modelKind === 'vlm' ? 'vlm' : 'lm';
  }

  async bind(
    process: MlxProcess,
    formatterOptions: FormatterOptions,
    messageProcessor?: (messages: MlxMessage[]) => MlxMessage[],
  ): Promise<void> {
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
      await this.loadIndex();
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

  private async loadIndex(): Promise<void> {
    try {
      if (!existsSync(this.indexPath)) return;
      const release = await lockFile(this.indexPath, { realpath: false });
      try {
        const raw = await readFile(this.indexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
          this.cacheIndex = parsed;
        }
      } finally {
        await release();
      }
    } catch {
      // corrupt index or lock failure — start fresh
    }
  }

  private async saveIndex(): Promise<void> {
    if (this.managedDir) return;
    try {
      await this.ensureCacheDir();
      const release = await lockFile(this.indexPath, { realpath: false });
      try {
        await writeFile(this.indexPath, JSON.stringify(this.cacheIndex, null, 2));
      } finally {
        await release();
      }
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
      hashes.push('i:' + createHash('sha256').update(JSON.stringify(el)).digest('hex'));
    }
    for (const el of params.data || []) {
      hashes.push('d:' + createHash('sha256').update(JSON.stringify(el)).digest('hex'));
    }
    return hashes;
  }

  private readPrefixMeta(cachePath: string): { tokenCount: number; prefixOffsets: number[]; prefixHashes: string[] } | undefined {
    try {
      const raw = readFileSync(cachePath + '.meta.json', 'utf-8');
      const meta = JSON.parse(raw);
      if (!Array.isArray(meta.prefix_offsets) || !Array.isArray(meta.prefix_hashes)) return undefined;
      return {
        tokenCount: typeof meta.token_count === 'number' ? meta.token_count : 0,
        prefixOffsets: meta.prefix_offsets,
        prefixHashes: meta.prefix_hashes,
      };
    } catch {
      return undefined;
    }
  }

  private computeTokenPrefixHash(tokens: number[], length: number): string {
    const buffer = Buffer.alloc(length * 4);
    for (let i = 0; i < length; i++) buffer.writeInt32LE(tokens[i], i * 4);
    return createHash('sha256').update(buffer).digest('hex');
  }

  private async computePrefixInfo(
    params: CachePrepareParams,
    fullTokens: number[],
    mlxTools: MlxToolDefinition[] | undefined,
  ): Promise<{ offsets: number[]; hashes: string[] }> {
    const instructions = params.instructions || [];
    const data = params.data || [];

    const offsets: number[] = [];
    const hashes: string[] = [];

    const boundaryIndices = new Set<number>();

    if (instructions.length > 0 && data.length > 0) {
      boundaryIndices.add(instructions.length - 1);
    }

    // data部分を前方から走査し、連続するimmutableの最後の位置を境界にする
    // instructionsはcacheHint不問でsection境界が既にカバーしている
    let lastImmutableIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i].cacheHint === 'immutable') {
        lastImmutableIdx = instructions.length + i;
      } else {
        break;
      }
    }
    if (lastImmutableIdx >= 0) {
      boundaryIndices.add(lastImmutableIdx);
    }

    // SetからArrayに変換してソート（prefixOffsetsが昇順になることを保証）
    const sortedBoundaries = Array.from(boundaryIndices).sort((a, b) => a - b);

    for (const boundaryIdx of sortedBoundaries) {

      const partialInst = boundaryIdx < instructions.length
        ? instructions.slice(0, boundaryIdx + 1)
        : instructions;
      const partialData = boundaryIdx >= instructions.length
        ? data.slice(0, boundaryIdx - instructions.length + 1)
        : [];

      const partialPrompt: CompiledPrompt = {
        instructions: partialInst,
        data: partialData,
        output: [],
      };

      const chatMessages = formatPromptAsMessages(partialPrompt, this.formatterOptions);
      let mlxMessages = convertMessages(chatMessages);
      if (this.messageProcessor) {
        mlxMessages = this.messageProcessor(mlxMessages);
      }

      try {
        const result = await this.process!.tokenize(mlxMessages, mlxTools, params.reasoningEffort as 'low' | 'medium' | 'high' | undefined);
        if (result.error || !result.token_ids) continue;

        const partialTokens = result.token_ids;
        let commonLen = 0;
        const maxLen = Math.min(partialTokens.length, fullTokens.length);
        for (let i = 0; i < maxLen; i++) {
          if (partialTokens[i] !== fullTokens[i]) break;
          commonLen = i + 1;
        }

        if (commonLen > 0) {
          offsets.push(commonLen);
          hashes.push(this.computeTokenPrefixHash(fullTokens, commonLen));
        }
      } catch {
        // tokenize failure for this boundary — skip
      }
    }

    // Always include the full sequence hash for base cache verification
    offsets.push(fullTokens.length);
    hashes.push(this.computeTokenPrefixHash(fullTokens, fullTokens.length));

    return { offsets, hashes };
  }

  private async findBestBase(
    params: CachePrepareParams,
    fullTokens: number[],
  ): Promise<BaseCacheInfo | undefined> {
    // exact_cache_v1 VLM snapshots are intentionally not used for incremental
    // prefill.  A VLM cache is still eligible for an exact disk hit in
    // createCache(), but base_cache_path/trim_to_tokens remain Phase 3 work.
    if (this.modelKind === 'vlm') return undefined;
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
      if ((entry.backend ?? 'lm') !== 'lm') continue;
      if (entry.hint === 'release') continue;
      if (entry.model !== params.model || entry.formatterOptionsHash !== fmtHash) continue;
      if ((entry.toolsHash ?? '') !== newToolsHash) continue;
      if ((entry.reasoningEffort ?? '') !== (params.reasoningEffort ?? '')) continue;
      const path = entry.path ?? this.generateCachePath(entry.key);
      if (existsSync(path) && this.readMetaTokenCount(path) > 0) {
        candidates.push({ path, elementHashes: entry.elementHashes, label: entry.key.slice(0, 8) });
      } else {
        staleKeys.push(entry.key);
      }
    }

    if (this.lastHandle?.ref && this.lastElementHashes && existsSync(this.lastHandle.ref) && this.readMetaTokenCount(this.lastHandle.ref) > 0) {
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
      this.cacheIndex.entries = this.cacheIndex.entries.filter(
        e => !(staleKeys.includes(e.key) && (e.backend ?? 'lm') === 'lm'),
      );
      this.saveIndex().catch(() => {});
    }

    if (candidates.length === 0) return undefined;

    // Filter candidates by element hash prefix match
    const matchedCandidates: Array<{ candidate: Candidate; elementMatchLength: number }> = [];
    for (const c of candidates) {
      const maxLen = Math.min(c.elementHashes.length, newHashes.length);
      let matchLength = 0;
      for (let i = 0; i < maxLen; i++) {
        if (c.elementHashes[i] !== newHashes[i]) break;
        matchLength++;
      }
      if (matchLength > 0) {
        matchedCandidates.push({ candidate: c, elementMatchLength: matchLength });
      }
    }

    if (matchedCandidates.length === 0) return undefined;

    // Verify token-level prefix match using prefix_hashes
    let bestMatchOffset = 0;
    let bestInfo: BaseCacheInfo | undefined;

    for (const { candidate: c, elementMatchLength } of matchedCandidates) {
      const meta = this.readPrefixMeta(c.path);

      if (elementMatchLength === c.elementHashes.length && elementMatchLength >= newHashes.length) {
        // All elements match — full cache hit
        const tokenCount = meta?.tokenCount ?? this.readMetaTokenCount(c.path);
        if (tokenCount > bestMatchOffset) {
          bestMatchOffset = tokenCount;
          bestInfo = {
            path: c.path,
            coversAll: true,
            sourceElementHashes: c.elementHashes,
          };
        }
        continue;
      }

      // Partial match — need prefix_hashes to verify token-level prefix
      if (!meta || meta.prefixOffsets.length === 0) {
        logger.debug(`findBestBase: skip ${c.label} (no prefix meta)`);
        continue;
      }

      // Find the longest prefix hash match
      let matchOffset = 0;
      for (let i = 0; i < meta.prefixHashes.length; i++) {
        const offset = meta.prefixOffsets[i];
        if (offset > fullTokens.length) break;
        const hash = this.computeTokenPrefixHash(fullTokens, offset);
        if (hash !== meta.prefixHashes[i]) break;
        matchOffset = offset;
      }

      if (matchOffset > 0 && matchOffset > bestMatchOffset) {
        bestMatchOffset = matchOffset;
        bestInfo = {
          path: c.path,
          trimTokens: matchOffset,
          coversAll: elementMatchLength >= newHashes.length,
          sourceElementHashes: c.elementHashes,
        };
      }
    }

    if (bestInfo) {
      logger.verbose(
        `findBestBase: match at ${bestMatchOffset} tokens`,
        bestInfo.trimTokens != null ? `(trim to ${bestInfo.trimTokens} tokens)` : '',
        bestInfo.coversAll ? '(covers all)' : '',
      );
    }

    return bestInfo;
  }

  private addToIndex(params: CachePrepareParams, cacheKey: string, cachePath: string): void {
    // avoid duplicates while refreshing the actual backend path after a VLM
    // prefill (the logical path is only the namespace seed).
    const existing = this.cacheIndex.entries.find(
      e => e.key === cacheKey && (e.backend ?? 'lm') === this.modelKind,
    );
    if (existing) {
      existing.backend = this.modelKind;
      if (this.modelKind === 'vlm') {
        existing.path = this.toIndexCachePath(cachePath);
      }
      existing.hint = undefined;
      return;
    }

    this.cacheIndex.entries.push({
      key: cacheKey,
      model: params.model,
      formatterOptionsHash: this.computeFormatterOptionsHash(),
      elementHashes: this.computeElementHashes(params),
      toolsHash: this.computeToolsHash(params.tools),
      reasoningEffort: params.reasoningEffort,
      createdAt: new Date().toISOString(),
      backend: this.modelKind,
      path: this.modelKind === 'vlm' ? this.toIndexCachePath(cachePath) : undefined,
    });
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
    const extension = CACHE_FILE_EXTENSIONS[this.modelKind];
    return join(this.cacheDir, `${cacheKey}${extension}`);
  }

  private getIndexedCachePath(cacheKey: string): string | undefined {
    const indexedPath = this.cacheIndex.entries.find(
      e => e.key === cacheKey && (e.backend ?? 'lm') === this.modelKind,
    )?.path;
    if (!indexedPath) return undefined;
    return isAbsolute(indexedPath) ? indexedPath : join(this.cacheDir, indexedPath);
  }

  private getEntryCachePath(entry: CacheIndexEntry): string {
    if (entry.path) {
      return isAbsolute(entry.path) ? entry.path : join(this.cacheDir, entry.path);
    }
    return this.generateCachePath(entry.key);
  }

  private toIndexCachePath(cachePath: string): string {
    if (this.modelKind !== 'vlm') {
      return cachePath;
    }
    const absoluteCachePath = isAbsolute(cachePath) ? cachePath : resolvePath(cachePath);
    const relativePath = relative(this.cacheDir, absoluteCachePath);
    // Backend-created VLM paths are inside cacheDir. Keep an absolute path
    // only for an incompatible/custom backend result that cannot be relocated.
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      return cachePath;
    }
    return relativePath;
  }

  recordQuery(): void {
    this.stats.totalQueries++;
  }

  recordPromptTokens(newPromptTokens: number, cacheTokensUsed: number): void {
    this.stats.totalPromptTokens += newPromptTokens + cacheTokensUsed;
    this.stats.totalCacheTokensUsed += cacheTokensUsed;
  }

  readCacheTokenCount(cachePath: string): number {
    return this.cacheTokenCounts.get(cachePath) ?? this.readMetaTokenCount(cachePath);
  }

  getStats() {
    const s = this.stats;
    return {
      totalQueries: s.totalQueries,
      incremental: s.incremental, fresh: s.fresh,
      totalPromptTokens: s.totalPromptTokens,
      prefillReusedTokens: s.prefillReusedTokens,
      cacheGrowthTokens: s.prefillTokens - s.prefillReusedTokens,
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

    // VLM prefill returns the actual APC snapshot path.  Reuse that path when
    // a fixed-cache index has it; otherwise start with a deterministic logical
    // path that the Python backend turns into a DiskBlockStore namespace.
    const indexedPath = this.getIndexedCachePath(cacheKey);
    const cachePath = indexedPath
      && existsSync(indexedPath)
      && existsSync(indexedPath + '.meta.json')
      && this.readMetaTokenCount(indexedPath) > 0
      ? indexedPath
      : this.generateCachePath(cacheKey);
    let effectiveCachePath = cachePath;
    const elementHashes = this.computeElementHashes(params);
    let supersededRef: string | undefined;

    // Disk hit check (exact same cache already exists).  Both LM archives and
    // VLM exact_cache_v1 snapshots use the same sidecar token-count contract.
    if (existsSync(cachePath) && existsSync(cachePath + '.meta.json') && this.readMetaTokenCount(cachePath) > 0) {
      this.stats.diskHit++;
      this.cacheTokenCounts.set(cachePath, this.readMetaTokenCount(cachePath));
      logger.verbose('reusing existing cache file', cacheKey.slice(0, 12));
    } else {
      // Build messages early (needed for tokenize + findBestBase)
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
      const mlxTools = hasTools ? convertToolDefinitions(params.tools!) : undefined;

      // Tokenize to get full token IDs (for findBestBase + prefix computation)
      let fullTokens: number[] | null = null;
      try {
        const tokenResult = await this.process!.tokenize(
          mlxMessages, mlxTools,
          params.reasoningEffort as 'low' | 'medium' | 'high' | undefined,
        );
        if (!tokenResult.error && tokenResult.token_ids) {
          fullTokens = tokenResult.token_ids;
        }
      } catch {
        // tokenize failure — proceed without prefix matching
      }

      // Find best base cache.  VLM exact snapshots intentionally do not
      // participate in incremental prefill until a safe trim/replay protocol
      // is implemented.
      const base = this.modelKind === 'lm' && fullTokens
        ? await this.findBestBase(params, fullTokens)
        : undefined;

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
            tools: (params.tools?.length ?? 0) > 0,
          },
        };
        this.cacheByHash.set(cacheKey, handle);
        this.updateLastCache(handle, base.sourceElementHashes, params);
        return handle;
      }

      if (params.readOnly) {
        logger.verbose('read-only cache miss', cacheKey.slice(0, 12));
        return MlxCacheController.EMPTY_HANDLE;
      }

      if (base) {
        logger.verbose('incremental prefill from', base.path.split('/').pop(),
          base.trimTokens != null ? `(trim to ${base.trimTokens})` : '');
      }

      // Compute prefix info if we have full tokens
      let prefixOffsets: number[] | undefined;
      let prefixHashes: string[] | undefined;
      if (fullTokens) {
        const prefixInfo = await this.computePrefixInfo(params, fullTokens, mlxTools);
        if (prefixInfo.offsets.length > 0) {
          prefixOffsets = prefixInfo.offsets;
          prefixHashes = prefixInfo.hashes;
        }
      }

      logger.debug('prefill', cachePath);
      const prefillStart = performance.now();
      try {
        const prefillResult = await this.process!.cachePrefill(
          cachePath, mlxMessages,
          base?.path, base?.trimTokens,
          prefixOffsets, prefixHashes,
          mlxTools,
          params.reasoningEffort,
        );
        const returnedTokenCount = typeof prefillResult?.token_count === 'number'
          ? prefillResult.token_count
          : undefined;
        if (
          this.modelKind === 'vlm'
          && typeof prefillResult?.cache_path === 'string'
          && prefillResult.cache_path.length > 0
        ) {
          effectiveCachePath = prefillResult.cache_path;
        }
        const tokenCount = returnedTokenCount ?? this.readMetaTokenCount(effectiveCachePath);
        if (tokenCount > 0) {
          this.cacheTokenCounts.set(effectiveCachePath, tokenCount);
        }
      } catch (e) {
        logger.verbose('prefill failed, skipping cache:', e instanceof Error ? e.message : String(e));
        return MlxCacheController.EMPTY_HANDLE;
      }
      const prefillMs = performance.now() - prefillStart;
      const newTokens = this.readCacheTokenCount(effectiveCachePath);
      this.stats.prefillTokens += newTokens;
      if (base) {
        this.stats.incremental++;
        this.stats.prefillReusedTokens += base.trimTokens ?? this.readMetaTokenCount(base.path);
        supersededRef = base.path;
      } else {
        this.stats.fresh++;
      }
      logger.verbose(`prefill ${prefillMs.toFixed(0)}ms`,
        base ? '(incremental)' : '(fresh)');

      if (this.closed) {
        await unlink(effectiveCachePath).catch(() => {});
        await unlink(effectiveCachePath + '.meta.json').catch(() => {});
        return MlxCacheController.EMPTY_HANDLE;
      }
    }

    const handle: CacheHandle = {
      ref: effectiveCachePath,
      includes: {
        instructions: (params.instructions?.length ?? 0) > 0,
        dataElementCount: params.data?.length ?? 0,
        tools: (params.tools?.length ?? 0) > 0,
      },
      supersedes: supersededRef,
    };
    this.cacheByHash.set(cacheKey, handle);
    this.updateLastCache(handle, elementHashes, params);

    this.addToIndex(params, cacheKey, effectiveCachePath);
    if (supersededRef) {
      this.release(supersededRef);
    }
    await this.saveIndex();

    return handle;
  }

  release(ref: string): void {
    logger.debug('release', ref);
    const entry = this.cacheIndex.entries.find(
      e => this.getEntryCachePath(e) === ref,
    );
    if (entry) {
      entry.hint = 'release';
    }
    for (const [key, handle] of this.cacheByHash) {
      if (handle.ref === ref) {
        this.cacheByHash.delete(key);
      }
    }
    if (this.lastHandle?.ref === ref) {
      this.clearLastCache();
    }
    this.saveIndex().catch(() => {});
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
    this.cacheTokenCounts.clear();
    this.clearLastCache();
    if (this.managedDir && this.cacheDir) {
      await rm(this.cacheDir, { recursive: true, force: true }).catch(() => {});
    } else {
      const released = this.cacheIndex.entries.filter(e => e.hint === 'release');
      await Promise.allSettled(released.flatMap(entry => {
        const path = this.getEntryCachePath(entry);
        return [unlink(path), unlink(path + '.meta.json')];
      }));
      this.cacheIndex.entries = this.cacheIndex.entries.filter(e => e.hint !== 'release');
      await this.saveIndex();
    }
    this.cacheDirReady = false;
    if (this.cleanupHandler) {
      globalThis.process.removeListener('exit', this.cleanupHandler);
    }
  }
}
