import { merge } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';

/**
 * Generic extraction base module for document/context extraction.
 * Derived from agentic workflow `extractContext` task definition.
 */
export const defaultExtractBaseModule: PromptModule = {
  objective: ['Extract relevant information from the provided data according to your Focus.'],
  instructions: [
    'Extract information from the provided inputs, messages, and materials according to your Focus.',
    'Be exhaustive — do not omit any relevant information.',
    'Combine direct quoting and summarization: quote key phrases or data verbatim, and summarize surrounding context.',
    'This is an extraction task: gather and organize what is present in the data. Do not interpret, infer, or add your own reasoning.',
    'Structure the extracted information clearly so that subsequent extractions can use it directly.',
  ],
};

/**
 * Merge the default extract base module with a custom overlay.
 * Use when you want generic extraction behavior plus domain-specific objective/instructions.
 */
export function mergeExtractBaseModule<TContext>(
  overlay: PromptModule<TContext>,
): PromptModule<TContext> {
  return merge(defaultExtractBaseModule, overlay);
}
