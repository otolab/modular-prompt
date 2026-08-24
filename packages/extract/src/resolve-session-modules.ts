import { merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';
import { defaultExtractBaseModule } from './modules/default-base-module.js';
import type { ExtractSessionOptions } from './types.js';
import type { ExtractContext } from './extract-context.js';

/**
 * base (+ optional domain) を解決する。
 * baseModule 未指定時は defaultExtractBaseModule を使用する。
 */
export function resolveSessionModules<TContext = ExtractContext>(
  options: Pick<ExtractSessionOptions<TContext>, 'baseModule' | 'domainModule'>,
): PromptModule<TContext> {
  const base = (options.baseModule ?? defaultExtractBaseModule) as PromptModule<TContext>;

  if (options.domainModule) {
    return merge(base, options.domainModule);
  }

  return base;
}
