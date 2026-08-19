import { merge, compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { buildCorpusModule, buildRequestModule } from './build-modules.js';
import {
  buildCacheModule,
  ensureCacheControllerReady,
  prepareSessionCache,
  releaseSessionCache,
  resolveModelName,
  type CacheLifecycleState,
} from './cache-lifecycle.js';
import { defaultExtractBaseModule } from './default-base-module.js';
import type { ExtractRequest, ExtractResult, ExtractSession, ExtractSessionOptions } from './types.js';

function buildSessionBaseModule<TContext>(
  baseModule: PromptModule<TContext>,
  schema?: object
): PromptModule<TContext> {
  if (!schema) {
    return baseModule;
  }

  const schemaModule: PromptModule = {
    schema: [{ type: 'json', content: schema }],
  };

  return merge(baseModule, schemaModule);
}

export function createExtractSession<TContext = unknown>(
  options: ExtractSessionOptions<TContext>
): ExtractSession {
  const { driver, baseModule = defaultExtractBaseModule, corpus, schema, cacheController } = options;
  const cacheEnabled = cacheController != null;
  const model = resolveModelName(options.model, cacheEnabled);
  const ownsCacheController = false;

  const sessionBaseModule = buildSessionBaseModule(baseModule, schema);
  const corpusModule = buildCorpusModule(corpus);
  const history: ExtractResult[] = [];
  const cacheState: CacheLifecycleState = {
    handle: null,
    controllerReady: false,
  };
  let closed = false;

  return {
    async extract(request: ExtractRequest): Promise<ExtractResult> {
      if (closed) {
        throw new Error('ExtractSession is closed');
      }

      if (cacheEnabled && cacheController && model) {
        await ensureCacheControllerReady(driver, cacheState);
        const cacheModule = buildCacheModule(sessionBaseModule, corpusModule, request);
        await prepareSessionCache(
          cacheController,
          model,
          cacheModule,
          request,
          cacheState,
        );
      }

      const requestModule = buildRequestModule(request);
      const merged = merge(sessionBaseModule, corpusModule, requestModule);
      const compiled = compile(merged);
      const queryOptions = cacheEnabled && cacheState.handle
        ? {
            ...request.options,
            cache: false as const,
            cacheHandle: cacheState.handle,
          }
        : request.options;

      const queryResult = await driver.query(compiled, queryOptions);

      const result: ExtractResult = {
        text: queryResult.content,
        structured: queryResult.structuredOutput,
        usage: queryResult.usage,
        index: history.length,
      };

      history.push(result);
      return result;
    },

    getHistory(): ReadonlyArray<ExtractResult> {
      return [...history];
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;

      if (cacheEnabled && cacheController) {
        releaseSessionCache(cacheController, cacheState);
        if (ownsCacheController) {
          await cacheController.close();
        }
      }

      await driver.close();
    },
  };
}
