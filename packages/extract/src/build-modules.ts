import type { PromptModule, SectionContent, TextElement } from '@modular-prompt/core';
import type { ExtractCorpus, ExtractRequest } from './types.js';
import {
  normalizeInputs,
  normalizeMaterials,
  normalizeMessages,
} from './extract-elements.js';

function withContextualCacheHint(content: SectionContent): SectionContent {
  return content.map((item) => {
    if (typeof item === 'string') {
      return {
        type: 'text',
        content: item,
        cacheHint: 'contextual',
      } satisfies TextElement;
    }
    if (item && typeof item === 'object' && 'type' in item) {
      return {
        ...item,
        cacheHint: item.cacheHint ?? 'contextual',
      };
    }
    return item;
  });
}

export function buildCorpusModule(corpus: ExtractCorpus): PromptModule {
  const module: PromptModule = {};
  const materials = normalizeMaterials(corpus.materials);
  const messages = normalizeMessages(corpus.messages);

  if (materials) {
    module.materials = [...materials];
  }
  if (messages) {
    module.messages = [...messages];
  }

  return module;
}

export function buildRequestModule(request: ExtractRequest): PromptModule {
  const cue = withContextualCacheHint(
    typeof request.cue === 'string' ? [request.cue] : request.cue,
  );

  const module: PromptModule = { cue };
  const inputs = normalizeInputs(request.inputs);

  if (inputs) {
    module.inputs = [...inputs];
  }

  return module;
}
