import type { ExtractResult } from './types.js';
import type { ChunkInput, InputsInput } from './extract-elements.js';
import { inputChunk } from './extract-elements.js';

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
 * 過去の抽出結果を読みやすいテキストブロック列に整形する。
 */
export function formatPreviousExtractions(
  extractions: ReadonlyArray<ExtractResult>,
): readonly string[] {
  if (extractions.length === 0) {
    return [];
  }
  return extractions.map(formatExtractionBlock);
}

/**
 * 段階的深掘り用の inputs を組み立てる。
 * 返却値を `ExtractRequest.inputs` にそのまま渡せる。
 */
export function buildPreviousExtractionsInputs(
  extractions: ReadonlyArray<ExtractResult>,
): InputsInput {
  const blocks = formatPreviousExtractions(extractions);
  if (blocks.length === 0) {
    return [];
  }
  if (blocks.length === 1) {
    return inputChunk(blocks[0]!, { partOf: 'previous-extractions' });
  }
  return blocks.map((content, index): ChunkInput =>
    inputChunk(content, {
      partOf: 'previous-extractions',
      index,
      total: blocks.length,
    }),
  );
}
