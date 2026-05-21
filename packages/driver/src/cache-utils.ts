import type { CompiledPrompt, Element } from '@modular-prompt/core';

export function isElementCacheable(el: Element): boolean {
  if ('cacheHint' in el) {
    return el.cacheHint === 'static' || el.cacheHint === 'immutable';
  }
  switch (el.type) {
    case 'message':
      if ('role' in el && el.role === 'tool') return false;
      return true;
    case 'material': return true;
    case 'section':
      if (el.title === 'Current State' || el.title === 'Input Chunks') return false;
      return true;
    case 'chunk': return false;
    default: return true;
  }
}

export interface PromptPartition {
  cacheable: {
    instructions: Element[];
    data: Element[];
  };
  volatile: {
    instructions: Element[];
    data: Element[];
    output: Element[];
  };
}

export interface CacheablePrefix {
  instructions: Element[];
  data: Element[];
}

export function extractCacheablePrefix(prompt: CompiledPrompt): CacheablePrefix {
  const instructions: Element[] = [];
  const data: Element[] = [];

  if (prompt.instructions) {
    for (const el of prompt.instructions) {
      if (!isElementCacheable(el)) break;
      instructions.push(el);
    }
  }

  const allInstructionsCacheable = instructions.length === (prompt.instructions?.length ?? 0);
  if (allInstructionsCacheable && prompt.data) {
    for (const el of prompt.data) {
      if (!isElementCacheable(el)) break;
      data.push(el);
    }
  }

  return { instructions, data };
}

export function partitionPrompt(prompt: CompiledPrompt): PromptPartition {
  const cacheable = {
    instructions: [] as Element[],
    data: [] as Element[],
  };
  const volatile = {
    instructions: [] as Element[],
    data: [] as Element[],
    output: prompt.output || [],
  };

  if (prompt.instructions) {
    for (const el of prompt.instructions) {
      if (isElementCacheable(el)) {
        cacheable.instructions.push(el);
      } else {
        volatile.instructions.push(el);
      }
    }
  }

  if (prompt.data) {
    for (const el of prompt.data) {
      if (isElementCacheable(el)) {
        cacheable.data.push(el);
      } else {
        volatile.data.push(el);
      }
    }
  }

  return { cacheable, volatile };
}
