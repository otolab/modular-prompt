import type { CompiledPrompt } from '@modular-prompt/core';
import type { FormatterOptions } from './types.js';
import { DefaultFormatter } from './formatter.js';
import { defaultFormatterTexts } from './converter.js';

/**
 * Default special tokens for Echo driver (HTML-like tags for visual distinction)
 */
export const ECHO_SPECIAL_TOKENS = {
  markers: {
    sectionStart: '<section>',
    sectionEnd: '</section>',
    subsectionStart: '<subsection>',
    subsectionEnd: '</subsection>',
    materialStart: '<material>',
    materialEnd: '</material>',
    chunkStart: '<chunk>',
    chunkEnd: '</chunk>'
  }
};

/**
 * Format a compiled prompt for completion API with section headers
 * This is the unified implementation used by both Echo driver (debug/test) and MLX driver (production)
 *
 * @param prompt - Compiled prompt to format
 * @param options - Formatter options including optional specialTokens or markers
 * @returns Formatted prompt string with section headers (# Instructions, # Data, # Output)
 */
export function formatCompletionPrompt(
  prompt: CompiledPrompt,
  options: FormatterOptions = {}
): string {
  const formatter = options.formatter || new DefaultFormatter(options);
  const {
    lineBreak = '\n',
    preamble,
    sectionDescriptions = defaultFormatterTexts.sectionDescriptions
  } = options;
  const sections: string[] = [];

  // Add preamble if provided
  if (preamble) {
    sections.push(preamble);
    sections.push('');
  }

  // Format instructions section with header
  if (prompt.instructions && prompt.instructions.length > 0) {
    sections.push('# Instructions');
    if (sectionDescriptions?.instructions) {
      sections.push('');
      sections.push(sectionDescriptions.instructions);
    }
    sections.push('');
    sections.push(formatter.formatAll(prompt.instructions));
  }

  // Format data section with header
  if (prompt.data && prompt.data.length > 0) {
    if (sections.length > 0) sections.push('');
    sections.push('# Data');
    if (sectionDescriptions?.data) {
      sections.push('');
      sections.push(sectionDescriptions.data);
    }
    sections.push('');
    sections.push(formatter.formatAll(prompt.data));
  }

  // Format output section with header
  const hasOutputElements = prompt.output && prompt.output.length > 0;
  const hasOutputSchema = !!prompt.metadata?.outputSchema;

  if (hasOutputElements || hasOutputSchema) {
    if (sections.length > 0) sections.push('');
    sections.push('# Output');
    if (sectionDescriptions?.output) {
      sections.push('');
      sections.push(sectionDescriptions.output);
    }
    if (hasOutputSchema) {
      sections.push('');
      const schemaContent = JSON.stringify(prompt.metadata!.outputSchema, null, 2);
      sections.push('### Output Schema');
      sections.push('');
      sections.push(defaultFormatterTexts.schemaInstruction);
      sections.push('');
      sections.push('JSONSchema:');
      sections.push('```json');
      sections.push(schemaContent);
      sections.push('```');
    }
    if (hasOutputElements) {
      sections.push('');
      sections.push(formatter.formatAll(prompt.output!));
    }
  }

  return sections.join(lineBreak);
}
