import { merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import type { ExtractContext } from './extract-context.js';
import type { ExtractRequest, ExtractResult, ExtractSession, ExtractSessionCloseOptions, ExtractSessionOptions } from './types.js';
import { resolveSessionModules } from './resolve-session-modules.js';
import { compileExtractPrompt } from './compile-extract-prompt.js';
import {
  ensureCacheControllerReady,
  prepareSessionCache,
  releaseSessionCache,
  resolveModelName,
  type CacheLifecycleState,
} from './cache-lifecycle.js';

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

export function createExtractSession<TContext = ExtractContext>(
  options: ExtractSessionOptions<TContext>
): ExtractSession {
  const { driver, corpus, schema, cacheController, baseModule } = options;
  const model = resolveModelName(options.model);

  const sessionBaseModule = buildSessionBaseModule(
    resolveSessionModules(options),
    schema,
  );
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

      await ensureCacheControllerReady(driver, cacheState);
      await prepareSessionCache(
        cacheController,
        model,
        sessionBaseModule,
        corpus,
        request,
        baseModule,
        cacheState,
      );

      const compiled = compileExtractPrompt(
        sessionBaseModule,
        corpus,
        request,
        baseModule,
      );
      const queryOptions = cacheState.handle
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

    async close(options?: ExtractSessionCloseOptions): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;

      if (options?.releaseCache !== false) {
        releaseSessionCache(cacheController, cacheState);
      }
    },
  };
}
