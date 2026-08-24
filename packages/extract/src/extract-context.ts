import type {
  ChunkElement,
  MaterialElement,
  MessageElement,
  SectionContent,
  TextElement,
} from '@modular-prompt/core';
import type { ExtractCorpus, ExtractRequest } from './types.js';
import {
  normalizeInputs,
  normalizeMaterials,
  normalizeMessages,
} from './extract-elements.js';

/** compile() に渡す抽出セッションのコンテキスト。 */
export interface ExtractContext {
  materials?: readonly MaterialElement[];
  messages?: readonly MessageElement[];
  inputs?: readonly ChunkElement[];
  cue: string | SectionContent;
}

export function normalizeCue(cue: string | SectionContent): SectionContent {
  return typeof cue === 'string' ? [cue] : cue;
}

export function buildExtractContext(
  corpus: ExtractCorpus,
  request: ExtractRequest,
): ExtractContext {
  return {
    materials: normalizeMaterials(corpus.materials),
    messages: normalizeMessages(corpus.messages),
    inputs: normalizeInputs(request.inputs),
    cue: request.cue,
  };
}

export function sectionHasContent<T>(content?: readonly T[]): content is readonly T[] {
  return content != null && content.length > 0;
}

export function expandCueContent(cue: string | SectionContent): TextElement[] {
  const content = normalizeCue(cue);
  const result: TextElement[] = [];

  for (const item of content) {
    if (typeof item === 'string') {
      result.push({ type: 'text', content: item, cacheHint: 'contextual' });
      continue;
    }
    if (typeof item === 'function') {
      continue;
    }
    if (item && typeof item === 'object' && item.type === 'text') {
      result.push({
        ...item,
        cacheHint: item.cacheHint ?? 'contextual',
      });
    }
  }

  return result;
}

export function sectionTemplateHeader(content: string): TextElement {
  return { type: 'text', content, cacheHint: 'static' };
}
