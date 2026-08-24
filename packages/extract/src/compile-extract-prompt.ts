import { merge, compile } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { buildCorpusModule, buildRequestModule } from './build-modules.js';
import type { ExtractCorpus, ExtractRequest } from './types.js';
import { buildExtractContext } from './extract-context.js';

export function usesDefaultDataTemplates(
  baseModule?: PromptModule,
): boolean {
  return baseModule === undefined;
}

export function buildCompileModule<TContext>(
  sessionBaseModule: PromptModule<TContext>,
  corpus: ExtractCorpus,
  request: ExtractRequest,
  baseModule?: PromptModule<TContext>,
): PromptModule<TContext> {
  if (usesDefaultDataTemplates(baseModule)) {
    return sessionBaseModule;
  }

  return merge(
    sessionBaseModule,
    buildCorpusModule(corpus),
    buildRequestModule(request),
  ) as PromptModule<TContext>;
}

export function compileExtractPrompt<TContext>(
  sessionBaseModule: PromptModule<TContext>,
  corpus: ExtractCorpus,
  request: ExtractRequest,
  baseModule?: PromptModule<TContext>,
) {
  const context = buildExtractContext(corpus, request) as TContext;
  const module = buildCompileModule(sessionBaseModule, corpus, request, baseModule);
  return compile(module, context);
}
