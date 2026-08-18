import type { PromptModule, SectionContent } from '@modular-prompt/core';
import type { ExtractCorpus, ExtractRequest } from './types.js';

function isSectionContent(value: unknown): value is SectionContent {
  return Array.isArray(value);
}

export function buildCorpusModule(corpus: ExtractCorpus): PromptModule {
  const module: PromptModule = {};

  if (corpus.materials) {
    module.materials = corpus.materials;
  }
  if (corpus.messages) {
    module.messages = corpus.messages;
  }

  return module;
}

export function buildRequestModule(request: ExtractRequest): PromptModule {
  const cue: SectionContent = typeof request.cue === 'string'
    ? [request.cue]
    : request.cue;

  const module: PromptModule = { cue };

  if (request.inputs !== undefined) {
    module.inputs = isSectionContent(request.inputs)
      ? request.inputs
      : [JSON.stringify(request.inputs, null, 2)];
  }

  return module;
}
