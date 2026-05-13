import type { CompiledPrompt, Element } from '@modular-prompt/core';

export function isElementCacheable(el: Element): boolean {
  if ('cacheHint' in el) {
    return el.cacheHint === 'static';
  }
  switch (el.type) {
    case 'message': return true;
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
