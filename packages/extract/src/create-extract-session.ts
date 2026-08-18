import { merge, compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { buildCorpusModule, buildRequestModule } from './build-modules.js';
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
  const { driver, baseModule, corpus, schema } = options;
  const sessionBaseModule = buildSessionBaseModule(baseModule, schema);
  const corpusModule = buildCorpusModule(corpus);
  const history: ExtractResult[] = [];
  let closed = false;

  return {
    async extract(request: ExtractRequest): Promise<ExtractResult> {
      if (closed) {
        throw new Error('ExtractSession is closed');
      }

      const requestModule = buildRequestModule(request);
      const merged = merge(sessionBaseModule, corpusModule, requestModule);
      const compiled = compile(merged);
      const queryResult = await driver.query(compiled, request.options);

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
      await driver.close();
    },
  };
}
