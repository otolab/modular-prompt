import { formatCompletionPrompt } from '@modular-prompt/driver';
import { compileExtractPrompt } from '../compile-extract-prompt.js';
import { defaultExtractBaseModule } from '../modules/default-base-module.js';
import type { ExtractCorpus, ExtractRequest } from '../types.js';

/**
 * compile + completion 形式で抽出プロンプト全文をレンダリングする（MLX 不要）。
 */
export function renderExtractPrompt(
  corpus: ExtractCorpus,
  request: ExtractRequest,
): string {
  const compiled = compileExtractPrompt(
    defaultExtractBaseModule,
    corpus,
    request,
    undefined,
  );
  return formatCompletionPrompt(compiled);
}
