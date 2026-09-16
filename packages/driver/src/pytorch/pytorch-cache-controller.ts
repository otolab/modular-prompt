import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { lock as lockFile } from 'proper-lockfile';
import type { CompiledPrompt } from '@modular-prompt/core';
import { Logger } from '@modular-prompt/utils';
import type {
  CacheHandle,
  CachePrepareParams,
  PromptCacheController,
} from '../cache-controller.js';
import type { ToolDefinition } from '../types.js';
import type { FormatterOptions } from '../formatter/types.js';
import { formatPromptAsMessages } from '../formatter/converter.js';
import type {
  InferenceMessage,
  InferenceToolDefinition,
} from '../local-inference/protocol.js';
import type { PyTorchProcess } from './process/index.js';
import { convertMessages, convertToolDefinitions } from '../mlx-ml/mlx-message-utils.js';

const logger = new Logger({ prefix: 'PyTorch', context: 'cache' });
const CACHE_FILE_EXTENSION = '.pytorch-cache';
const PYTORCH_BACKEND = 'pytorch' as const;

interface CacheIndexEntry {
  key: string;
  model: string;
  formatterOptionsHash: string;
  elementHashes: string[];
  toolsHash?: string;
  reasoningEffort?: string;
  createdAt: string;
  hint?: 'retain' | 'release';
  /** Backend-specific cache format. */
  backend?: 'lm' | 'vlm' | typeof PYTORCH_BACKEND;
  /** Cache path relative to cacheDir when possible. */
  path?: string;
}

interface CacheIndex {
  version: 1;
  entries: CacheIndexEntry[];
}

export interface PyTorchCacheControllerOptions {
  /** 固定キャッシュディレクトリ。指定時はauto-cleanupが無効になる */
  cacheDir?: string;
}

interface BaseCacheInfo {
  path: string;
  trimTokens?: number;
  /** base cacheが新プロンプトの全要素をカバーしているか */
  coversAll: boolean;
  /** base cacheが実際に保持している要素ハッシュ */
  sourceElementHashes: string[];
}

/**
 * PyTorch Transformers backend 用の PromptCacheController。
 *
 * キャッシュ本体の形式・検証・寿命は Python backend が所有する。
 * このクラスは、プロンプト要素から安定した ref を生成し、LIP の
 * cache_prefill / generate と PromptCacheController の usage 契約を橋渡しする。
 */
export class PyTorchCacheController implements PromptCacheController {
  private cacheByHash = new Map<string, CacheHandle>();
  private inflightRequests = new Map<string, Promise<CacheHandle>>();
  private process?: PyTorchProcess;
  private cacheDir: string;
  private managedDir: boolean;
  private cacheDirReady = false;
  private closed = false;
  private bound = false;
  private modelKind: 'lm' | 'vlm' = 'lm';
  private cleanupHandler?: () => void;
  private messageProcessor?: (messages: InferenceMessage[]) => InferenceMessage[];
  private formatterOptions: FormatterOptions = {};
  private lastHandle?: CacheHandle;
  private lastElementHashes?: string[];
  private lastHandleModel?: string;
  private lastHandleFormatterOptionsHash?: string;
  private lastHandleToolsHash?: string;
  private lastHandleReasoningEffort?: string;
  private cacheIndex: CacheIndex = { version: 1, entries: [] };
  /** Token counts returned by the backend for process-local refs. */
  private cacheTokenCounts = new Map<string, number>();
  private stats = {
    totalQueries: 0,
    memoryHit: 0,
    diskHit: 0,
    incremental: 0,
    fresh: 0,
    prefillTokens: 0,
    prefillReusedTokens: 0,
    totalPromptTokens: 0,
    totalCacheTokensUsed: 0,
  };

  private static readonly EMPTY_HANDLE: CacheHandle = {
    ref: '',
    includes: { instructions: false, dataElementCount: 0, tools: false },
  };

  constructor(options?: PyTorchCacheControllerOptions) {
    if (options?.cacheDir) {
      // Python runtime may have a different cwd.  Resolve relative paths once
      // so refs and cache-index paths remain stable across process calls.
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
      throw new Error('PyTorchCacheController model kind must be set before bind');
    }
    this.modelKind = modelKind === 'vlm' ? 'vlm' : 'lm';
  }

  async bind(
    process: PyTorchProcess,
    formatterOptions: FormatterOptions,
    messageProcessor?: (messages: InferenceMessage[]) => InferenceMessage[],
  ): Promise<void> {
    if (this.bound) {
      throw new Error('PyTorchCacheController is already bound to a process');
    }

    this.process = process;
    this.formatterOptions = formatterOptions;
    this.messageProcessor = messageProcessor;
    if (!this.cacheDir) {
      this.cacheDir = join(tmpdir(), `pytorch-prompt-cache-${randomBytes(6).toString('hex')}`);
    }

    if (this.managedDir) {
      this.cleanupHandler = () => {
        try {
          rmSync(this.cacheDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup during process exit
        }
      };
      globalThis.process.on('exit', this.cleanupHandler);
    } else {
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
      return typeof meta.token_count === 'number' && Number.isFinite(meta.token_count)
        ? Math.max(0, meta.token_count)
        : 0;
    } catch {
      return 0;
    }
  }

  private readPrefixMeta(
    cachePath: string,
  ): { tokenCount: number; prefixOffsets: number[]; prefixHashes: string[] } | undefined {
    try {
      const raw = readFileSync(cachePath + '.meta.json', 'utf-8');
      const meta = JSON.parse(raw);
      if (!Array.isArray(meta.prefix_offsets) || !Array.isArray(meta.prefix_hashes)) {
        return undefined;
      }
      return {
        tokenCount: typeof meta.token_count === 'number' ? Math.max(0, meta.token_count) : 0,
        prefixOffsets: meta.prefix_offsets,
        prefixHashes: meta.prefix_hashes,
      };
    } catch {
      return undefined;
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      if (!existsSync(this.indexPath)) return;
      const release = await lockFile(this.indexPath, { realpath: false });
      try {
        const raw = await readFile(this.indexPath, 'utf-8');
        const parsed = JSON.parse(raw) as CacheIndex;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
          this.cacheIndex = parsed;
        }
      } finally {
        await release();
      }
    } catch {
      // A corrupt index or lock failure should not disable inference.
    }
  }

  private async saveIndex(): Promise<void> {
    if (this.managedDir) return;
    try {
      await this.ensureCacheDir();
      // proper-lockfile locks an existing file.  Seed it before acquiring the
      // lock on the first write; subsequent writes replace its contents while
      // holding the lock.
      if (!existsSync(this.indexPath)) {
        await writeFile(this.indexPath, JSON.stringify(this.cacheIndex, null, 2));
      }
      const release = await lockFile(this.indexPath, { realpath: false });
      try {
        await writeFile(this.indexPath, JSON.stringify(this.cacheIndex, null, 2));
      } finally {
        await release();
      }
    } catch {
      // Cache persistence is best-effort; query execution must continue.
    }
  }

  private computeFormatterOptionsHash(): string {
    if (Object.keys(this.formatterOptions).length === 0) return '';
    return createHash('sha256').update(JSON.stringify(this.formatterOptions)).digest('hex');
  }

  private computeToolsHash(tools?: ToolDefinition[]): string {
    if (!tools || tools.length === 0) return '';
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  }

  private computeElementHashes(params: CachePrepareParams): string[] {
    const hashes: string[] = [];
    for (const element of params.instructions ?? []) {
      hashes.push(`i:${createHash('sha256').update(JSON.stringify(element)).digest('hex')}`);
    }
    for (const element of params.data ?? []) {
      hashes.push(`d:${createHash('sha256').update(JSON.stringify(element)).digest('hex')}`);
    }
    return hashes;
  }

  private computeCacheKey(params: CachePrepareParams): string {
    const payload: Record<string, unknown> = { model: params.model };
    if (params.instructions && params.instructions.length > 0) {
      payload.instructions = params.instructions;
    }
    if (params.data && params.data.length > 0) {
      payload.data = params.data;
    }
    if (Object.keys(this.formatterOptions).length > 0) {
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
    return join(this.cacheDir, `${cacheKey}${CACHE_FILE_EXTENSION}`);
  }

  private getIndexedCachePath(cacheKey: string): string | undefined {
    const indexedPath = this.cacheIndex.entries.find(
      (entry) => entry.key === cacheKey && entry.backend === PYTORCH_BACKEND,
    )?.path;
    if (!indexedPath) return undefined;
    if (indexedPath.startsWith('memory://')) return indexedPath;
    return isAbsolute(indexedPath) ? indexedPath : join(this.cacheDir, indexedPath);
  }

  private getEntryCachePath(entry: CacheIndexEntry): string {
    if (entry.path) {
      if (entry.path.startsWith('memory://')) return entry.path;
      return isAbsolute(entry.path) ? entry.path : join(this.cacheDir, entry.path);
    }
    return this.generateCachePath(entry.key);
  }

  private toIndexCachePath(cachePath: string): string {
    if (cachePath.startsWith('memory://')) return cachePath;
    const absoluteCachePath = isAbsolute(cachePath) ? cachePath : resolvePath(cachePath);
    const relativePath = relative(this.cacheDir, absoluteCachePath);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      return cachePath;
    }
    return relativePath;
  }

  private updateLastCache(
    handle: CacheHandle,
    elementHashes: string[],
    params: CachePrepareParams,
  ): void {
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

  private computeTokenPrefixHash(tokens: number[], length: number): string {
    const buffer = Buffer.alloc(length * 4);
    for (let i = 0; i < length; i++) {
      buffer.writeInt32LE(tokens[i], i * 4);
    }
    return createHash('sha256').update(buffer).digest('hex');
  }

  private async computePrefixInfo(
    params: CachePrepareParams,
    fullTokens: number[],
    tools: InferenceToolDefinition[] | undefined,
  ): Promise<{ offsets: number[]; hashes: string[] }> {
    const instructions = params.instructions ?? [];
    const data = params.data ?? [];
    const boundaryIndices = new Set<number>();

    if (instructions.length > 0 && data.length > 0) {
      boundaryIndices.add(instructions.length - 1);
    }

    // Instructions are already section boundaries.  Data may extend the
    // prefix only while it remains immutable and contiguous.
    let lastImmutableIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i].cacheHint === 'immutable') {
        lastImmutableIndex = instructions.length + i;
      } else {
        break;
      }
    }
    if (lastImmutableIndex >= 0) {
      boundaryIndices.add(lastImmutableIndex);
    }

    const offsets: number[] = [];
    const hashes: string[] = [];
    const addPrefix = (offset: number) => {
      if (offset <= 0 || offsets.includes(offset)) return;
      offsets.push(offset);
      hashes.push(this.computeTokenPrefixHash(fullTokens, offset));
    };

    for (const boundaryIndex of [...boundaryIndices].sort((a, b) => a - b)) {
      const partialInstructions = boundaryIndex < instructions.length
        ? instructions.slice(0, boundaryIndex + 1)
        : instructions;
      const partialData = boundaryIndex >= instructions.length
        ? data.slice(0, boundaryIndex - instructions.length + 1)
        : [];
      const partialPrompt: CompiledPrompt = {
        instructions: partialInstructions,
        data: partialData,
        output: [],
      };

      const chatMessages = formatPromptAsMessages(partialPrompt, this.formatterOptions);
      let inferenceMessages = convertMessages(chatMessages, false);
      if (this.messageProcessor) {
        inferenceMessages = this.messageProcessor(inferenceMessages);
      }

      try {
        const result = await this.process!.tokenize(inferenceMessages, tools, params.reasoningEffort);
        if (result.error || !result.token_ids) continue;

        let commonLength = 0;
        const maxLength = Math.min(result.token_ids.length, fullTokens.length);
        for (let i = 0; i < maxLength; i++) {
          if (result.token_ids[i] !== fullTokens[i]) break;
          commonLength = i + 1;
        }
        addPrefix(commonLength);
      } catch {
        // A tokenization failure only disables incremental matching.
      }
    }

    // The full sequence is needed to validate exact/superset candidates.
    addPrefix(fullTokens.length);
    return { offsets, hashes };
  }

  private async findBestBase(
    params: CachePrepareParams,
    fullTokens: number[],
  ): Promise<BaseCacheInfo | undefined> {
    // PyTorch VLM is not supported by the current backend.  Keep this guard so
    // a direct controller call cannot accidentally create an image cache.
    if (this.modelKind === 'vlm') return undefined;

    const newHashes = this.computeElementHashes(params);
    if (newHashes.length === 0) return undefined;
    const formatterOptionsHash = this.computeFormatterOptionsHash();
    const toolsHash = this.computeToolsHash(params.tools);

    interface Candidate {
      path: string;
      elementHashes: string[];
      label: string;
    }
    const candidates: Candidate[] = [];
    const staleKeys: string[] = [];

    for (const entry of this.cacheIndex.entries) {
      if (entry.backend !== PYTORCH_BACKEND) continue;
      if (entry.hint === 'release') continue;
      if (
        entry.model !== params.model
        || entry.formatterOptionsHash !== formatterOptionsHash
        || (entry.toolsHash ?? '') !== toolsHash
        || (entry.reasoningEffort ?? '') !== (params.reasoningEffort ?? '')
      ) {
        continue;
      }

      const path = this.getEntryCachePath(entry);
      if (existsSync(path) && this.readMetaTokenCount(path) > 0) {
        candidates.push({ path, elementHashes: entry.elementHashes, label: entry.key.slice(0, 8) });
      } else {
        staleKeys.push(entry.key);
      }
    }

    if (
      this.lastHandle?.ref
      && this.lastElementHashes
      && existsSync(this.lastHandle.ref)
      && this.readMetaTokenCount(this.lastHandle.ref) > 0
    ) {
      const lastCompatible =
        this.lastHandleModel === params.model
        && this.lastHandleFormatterOptionsHash === formatterOptionsHash
        && (this.lastHandleToolsHash ?? '') === toolsHash
        && (this.lastHandleReasoningEffort ?? '') === (params.reasoningEffort ?? '');
      if (lastCompatible && !candidates.some((candidate) => candidate.path === this.lastHandle!.ref)) {
        candidates.push({
          path: this.lastHandle.ref,
          elementHashes: this.lastElementHashes,
          label: 'lastHandle',
        });
      }
    }

    if (staleKeys.length > 0) {
      this.cacheIndex.entries = this.cacheIndex.entries.filter(
        (entry) => !(staleKeys.includes(entry.key) && entry.backend === PYTORCH_BACKEND),
      );
      this.saveIndex().catch(() => {});
    }
    if (candidates.length === 0) return undefined;

    const matchedCandidates: Array<{ candidate: Candidate; elementMatchLength: number }> = [];
    for (const candidate of candidates) {
      const maxLength = Math.min(candidate.elementHashes.length, newHashes.length);
      let matchLength = 0;
      for (let i = 0; i < maxLength; i++) {
        if (candidate.elementHashes[i] !== newHashes[i]) break;
        matchLength++;
      }
      if (matchLength > 0) {
        matchedCandidates.push({ candidate, elementMatchLength: matchLength });
      }
    }
    if (matchedCandidates.length === 0) return undefined;

    let bestMatchOffset = 0;
    let bestInfo: BaseCacheInfo | undefined;
    for (const { candidate, elementMatchLength } of matchedCandidates) {
      const meta = this.readPrefixMeta(candidate.path);

      if (elementMatchLength === candidate.elementHashes.length && elementMatchLength >= newHashes.length) {
        const tokenCount = meta?.tokenCount ?? this.readMetaTokenCount(candidate.path);
        if (tokenCount > bestMatchOffset) {
          bestMatchOffset = tokenCount;
          bestInfo = {
            path: candidate.path,
            coversAll: true,
            sourceElementHashes: candidate.elementHashes,
          };
        }
        continue;
      }

      if (!meta || meta.prefixOffsets.length === 0) {
        logger.debug(`findBestBase: skip ${candidate.label} (no prefix meta)`);
        continue;
      }

      let matchOffset = 0;
      for (let i = 0; i < meta.prefixHashes.length; i++) {
        const offset = meta.prefixOffsets[i];
        if (typeof offset !== 'number' || offset <= 0 || offset > fullTokens.length) break;
        if (this.computeTokenPrefixHash(fullTokens, offset) !== meta.prefixHashes[i]) break;
        matchOffset = offset;
      }
      if (matchOffset > 0 && matchOffset > bestMatchOffset) {
        bestMatchOffset = matchOffset;
        bestInfo = {
          path: candidate.path,
          trimTokens: matchOffset,
          coversAll: elementMatchLength >= newHashes.length,
          sourceElementHashes: candidate.elementHashes,
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
    const existing = this.cacheIndex.entries.find(
      (entry) => entry.key === cacheKey && entry.backend === PYTORCH_BACKEND,
    );
    if (existing) {
      existing.backend = PYTORCH_BACKEND;
      existing.path = this.toIndexCachePath(cachePath);
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
      backend: PYTORCH_BACKEND,
      path: this.toIndexCachePath(cachePath),
    });
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
    const stats = this.stats;
    return {
      totalQueries: stats.totalQueries,
      memoryHit: stats.memoryHit,
      diskHit: stats.diskHit,
      incremental: stats.incremental,
      fresh: stats.fresh,
      totalPromptTokens: stats.totalPromptTokens,
      prefillReusedTokens: stats.prefillReusedTokens,
      cacheGrowthTokens: stats.prefillTokens - stats.prefillReusedTokens,
    };
  }

  async prepare(params: CachePrepareParams): Promise<CacheHandle> {
    if (!this.bound) {
      throw new Error('PyTorchCacheController is not bound to a process');
    }
    const hasContent =
      (params.instructions?.length ?? 0) > 0 || (params.data?.length ?? 0) > 0;
    if (!hasContent) {
      throw new Error('Cannot prepare cache with no cacheable content');
    }
    if (this.modelKind === 'vlm') {
      return PyTorchCacheController.EMPTY_HANDLE;
    }

    const cacheKey = this.computeCacheKey(params);
    const existing = this.cacheByHash.get(cacheKey);
    if (existing) {
      this.stats.memoryHit++;
      logger.verbose('cache hit', cacheKey.slice(0, 12));
      return existing;
    }

    const inflight = this.inflightRequests.get(cacheKey);
    if (inflight) return inflight;

    const prepareStart = performance.now();
    const promise = this.createCache(params, cacheKey);
    this.inflightRequests.set(cacheKey, promise);
    try {
      const handle = await promise;
      logger.verbose(
        `prepare total ${(performance.now() - prepareStart).toFixed(0)}ms`,
        cacheKey.slice(0, 12),
      );
      return handle;
    } finally {
      this.inflightRequests.delete(cacheKey);
    }
  }

  private isUnsupportedIncrementalError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /does not support (incremental prefill|cache prefix metadata)/i.test(message);
  }

  private async createCache(params: CachePrepareParams, cacheKey: string): Promise<CacheHandle> {
    try {
      await this.ensureCacheDir();
    } catch (error) {
      logger.verbose(
        'cache dir creation failed, skipping cache:',
        error instanceof Error ? error.message : String(error),
      );
      return PyTorchCacheController.EMPTY_HANDLE;
    }

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

    if (
      existsSync(cachePath)
      && existsSync(cachePath + '.meta.json')
      && this.readMetaTokenCount(cachePath) > 0
    ) {
      this.stats.diskHit++;
      this.cacheTokenCounts.set(cachePath, this.readMetaTokenCount(cachePath));
      logger.verbose('reusing existing cache file', cacheKey.slice(0, 12));
    } else {
      const prefillPrompt: CompiledPrompt = {
        instructions: params.instructions ?? [],
        data: params.data ?? [],
        output: [],
      };
      const chatMessages = formatPromptAsMessages(prefillPrompt, this.formatterOptions);
      let inferenceMessages = convertMessages(chatMessages, false);
      if (this.messageProcessor) {
        inferenceMessages = this.messageProcessor(inferenceMessages);
      }

      const hasTools = (params.tools?.length ?? 0) > 0;
      const tools = hasTools ? convertToolDefinitions(params.tools!) : undefined;
      let fullTokens: number[] | undefined;
      try {
        const tokenResult = await this.process!.tokenize(inferenceMessages, tools, params.reasoningEffort);
        if (!tokenResult.error && tokenResult.token_ids) {
          fullTokens = tokenResult.token_ids;
        }
      } catch {
        // Cache creation can continue without incremental prefix matching.
      }

      const base = fullTokens ? await this.findBestBase(params, fullTokens) : undefined;
      if (base?.coversAll) {
        this.stats.diskHit++;
        const handle: CacheHandle = {
          ref: base.path,
          trimTokens: base.trimTokens,
          includes: {
            instructions: (params.instructions?.length ?? 0) > 0,
            dataElementCount: params.data?.length ?? 0,
            tools: hasTools,
          },
        };
        this.cacheByHash.set(cacheKey, handle);
        this.updateLastCache(handle, base.sourceElementHashes, params);
        return handle;
      }

      if (params.readOnly) {
        logger.verbose('read-only cache miss', cacheKey.slice(0, 12));
        return PyTorchCacheController.EMPTY_HANDLE;
      }

      let prefixOffsets: number[] | undefined;
      let prefixHashes: string[] | undefined;
      if (fullTokens) {
        const prefixInfo = await this.computePrefixInfo(params, fullTokens, tools);
        if (prefixInfo.offsets.length > 0) {
          prefixOffsets = prefixInfo.offsets;
          prefixHashes = prefixInfo.hashes;
        }
      }

      const prefillStart = performance.now();
      let prefillResult;
      let usedBase = base;
      try {
        prefillResult = await this.process!.cachePrefill(
          cachePath,
          inferenceMessages,
          base?.path,
          base?.trimTokens,
          prefixOffsets,
          prefixHashes,
          tools,
          params.reasoningEffort,
          params.images,
          params.maxImageSize,
        );
      } catch (error) {
        // The CUDA template intentionally rejects the CPU template's
        // incremental/prefix metadata.  Retry a plain prefill so one
        // controller works with either PyTorch runtime variant.
        if (!this.isUnsupportedIncrementalError(error) || (!usedBase && !prefixOffsets)) {
          logger.verbose(
            'prefill failed, skipping cache:',
            error instanceof Error ? error.message : String(error),
          );
          return PyTorchCacheController.EMPTY_HANDLE;
        }
        try {
          prefillResult = await this.process!.cachePrefill(
            cachePath,
            inferenceMessages,
            undefined,
            undefined,
            undefined,
            undefined,
            tools,
            params.reasoningEffort,
            params.images,
            params.maxImageSize,
          );
          usedBase = undefined;
        } catch (retryError) {
          logger.verbose(
            'prefill failed, skipping cache:',
            retryError instanceof Error ? retryError.message : String(retryError),
          );
          return PyTorchCacheController.EMPTY_HANDLE;
        }
      }

      if (typeof prefillResult?.cache_path === 'string' && prefillResult.cache_path.length > 0) {
        effectiveCachePath = prefillResult.cache_path;
      }
      const returnedTokenCount = typeof prefillResult?.token_count === 'number'
        ? Math.max(0, prefillResult.token_count)
        : undefined;
      const tokenCount = returnedTokenCount ?? this.readMetaTokenCount(effectiveCachePath);
      if (tokenCount > 0) {
        this.cacheTokenCounts.set(effectiveCachePath, tokenCount);
      }

      const reusedTokens = usedBase
        ? usedBase.trimTokens ?? this.readMetaTokenCount(usedBase.path)
        : 0;
      this.stats.prefillTokens += tokenCount;
      this.stats.prefillReusedTokens += reusedTokens;
      if (usedBase) {
        this.stats.incremental++;
        supersededRef = usedBase.path;
      } else {
        this.stats.fresh++;
      }
      logger.verbose(
        `prefill ${(performance.now() - prefillStart).toFixed(0)}ms`,
        usedBase ? '(incremental)' : '(fresh)',
      );

      if (this.closed) {
        await unlink(effectiveCachePath).catch(() => {});
        await unlink(effectiveCachePath + '.meta.json').catch(() => {});
        return PyTorchCacheController.EMPTY_HANDLE;
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
      (candidate) => candidate.backend === PYTORCH_BACKEND && this.getEntryCachePath(candidate) === ref,
    );
    if (entry) entry.hint = 'release';
    for (const [key, handle] of this.cacheByHash) {
      if (handle.ref === ref) this.cacheByHash.delete(key);
    }
    if (this.lastHandle?.ref === ref) this.clearLastCache();
    this.saveIndex().catch(() => {});
  }

  async close(): Promise<void> {
    this.closed = true;
    const timeout = new Promise<void>((resolve) => {
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
      const released = this.cacheIndex.entries.filter(
        (entry) => entry.backend === PYTORCH_BACKEND && entry.hint === 'release',
      );
      await Promise.allSettled(released.flatMap((entry) => {
        const path = this.getEntryCachePath(entry);
        if (path.startsWith('memory://')) return [];
        return [unlink(path), unlink(path + '.meta.json')];
      }));
      this.cacheIndex.entries = this.cacheIndex.entries.filter(
        (entry) => !(entry.backend === PYTORCH_BACKEND && entry.hint === 'release'),
      );
      await this.saveIndex();
    }

    this.cacheDirReady = false;
    if (this.cleanupHandler) {
      globalThis.process.removeListener('exit', this.cleanupHandler);
    }
  }
}
