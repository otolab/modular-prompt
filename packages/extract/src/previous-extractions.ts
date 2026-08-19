import type { SectionContent } from '@modular-prompt/core';
import type { ExtractResult } from './types.js';

function formatExtractionBlock(result: ExtractResult): string {
  const lines = [`### Extraction #${result.index + 1}`];
  if (result.text) {
    lines.push(result.text);
  }
  if (result.structured !== undefined) {
    lines.push('Structured output:');
    lines.push(JSON.stringify(result.structured, null, 2));
  }
  return lines.join('\n');
}

/**
 * Format previous extraction results as readable inputs section content.
 */
export function formatPreviousExtractions(
  extractions: ReadonlyArray<ExtractResult>,
): SectionContent {
  if (extractions.length === 0) {
    return [];
  }
  return extractions.map(formatExtractionBlock);
}

/**
 * Build inputs for progressive deep-dive extraction from previous results.
 * Pass the return value directly as `inputs` in `ExtractRequest`.
 */
export function buildPreviousExtractionsInputs(
  extractions: ReadonlyArray<ExtractResult>,
): SectionContent {
  return formatPreviousExtractions(extractions);
}
