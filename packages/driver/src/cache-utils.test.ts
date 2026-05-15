import { describe, it, expect } from 'vitest';
import type { CompiledPrompt, Element } from '@modular-prompt/core';
import { isElementCacheable, partitionPrompt, extractCacheablePrefix } from './cache-utils.js';

describe('isElementCacheable', () => {
  it('cacheHint: static → cacheable', () => {
    const el: Element = { type: 'text', content: 'hello', cacheHint: 'static' };
    expect(isElementCacheable(el)).toBe(true);
  });

  it('cacheHint: contextual → not cacheable', () => {
    const el: Element = { type: 'text', content: 'hello', cacheHint: 'contextual' };
    expect(isElementCacheable(el)).toBe(false);
  });

  it('message without cacheHint → cacheable', () => {
    const el: Element = { type: 'message', role: 'user', content: 'hi' };
    expect(isElementCacheable(el)).toBe(true);
  });

  it('tool message without cacheHint → not cacheable', () => {
    const el: Element = { type: 'message', role: 'tool', toolCallId: 'tc1', name: 'search', kind: 'text', value: 'result' } as Element;
    expect(isElementCacheable(el)).toBe(false);
  });

  it('material without cacheHint → cacheable', () => {
    const el: Element = { type: 'material', id: 'm1', title: 'Doc', content: 'text' };
    expect(isElementCacheable(el)).toBe(true);
  });

  it('chunk without cacheHint → not cacheable', () => {
    const el: Element = { type: 'chunk', partOf: 'doc', content: 'part' };
    expect(isElementCacheable(el)).toBe(false);
  });

  it('section "Current State" → not cacheable', () => {
    const el: Element = { type: 'section', category: 'data', title: 'Current State', items: ['state'] };
    expect(isElementCacheable(el)).toBe(false);
  });

  it('section "Input Chunks" → not cacheable', () => {
    const el: Element = { type: 'section', category: 'data', title: 'Input Chunks', items: ['chunk'] };
    expect(isElementCacheable(el)).toBe(false);
  });

  it('section with other title → cacheable', () => {
    const el: Element = { type: 'section', category: 'instructions', title: 'Guidelines', items: ['rule'] };
    expect(isElementCacheable(el)).toBe(true);
  });

  it('text without cacheHint → cacheable', () => {
    const el: Element = { type: 'text', content: 'hello' };
    expect(isElementCacheable(el)).toBe(true);
  });

  it('cacheHint overrides default heuristic', () => {
    const el: Element = { type: 'chunk', partOf: 'doc', content: 'part', cacheHint: 'static' };
    expect(isElementCacheable(el)).toBe(true);
  });

  it('cacheHint: immutable → cacheable', () => {
    const el: Element = { type: 'message', role: 'user', content: 'hi', cacheHint: 'immutable' };
    expect(isElementCacheable(el)).toBe(true);
  });
});

describe('partitionPrompt', () => {
  it('instructions without cacheHint go to cacheable', () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'Be helpful' }],
      data: [],
      output: [],
    };
    const result = partitionPrompt(prompt);
    expect(result.cacheable.instructions).toHaveLength(1);
    expect(result.volatile.instructions).toHaveLength(0);
    expect(result.cacheable.data).toHaveLength(0);
    expect(result.volatile.data).toHaveLength(0);
  });

  it('contextual instructions go to volatile', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Be helpful' },
        { type: 'text', content: 'Current time is 12:00', cacheHint: 'contextual' },
        { type: 'text', content: 'Static rule', cacheHint: 'static' },
      ],
      data: [],
      output: [],
    };
    const result = partitionPrompt(prompt);
    expect(result.cacheable.instructions).toHaveLength(2);
    expect(result.volatile.instructions).toHaveLength(1);
    expect(result.volatile.instructions[0].type).toBe('text');
  });

  it('data elements are partitioned by cacheability', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        { type: 'material', id: 'm1', title: 'Doc', content: 'text' },
        { type: 'chunk', partOf: 'doc', content: 'part' },
        { type: 'message', role: 'user', content: 'hello' },
      ],
      output: [],
    };
    const result = partitionPrompt(prompt);
    expect(result.cacheable.data).toHaveLength(2);
    expect(result.volatile.data).toHaveLength(1);
    expect(result.volatile.data[0].type).toBe('chunk');
  });

  it('output goes to volatile', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [],
      output: [{ type: 'text', content: 'respond now' }],
    };
    const result = partitionPrompt(prompt);
    expect(result.volatile.output).toHaveLength(1);
  });

  it('handles empty prompt', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [],
      output: [],
    };
    const result = partitionPrompt(prompt);
    expect(result.cacheable.instructions).toHaveLength(0);
    expect(result.volatile.instructions).toHaveLength(0);
    expect(result.cacheable.data).toHaveLength(0);
    expect(result.volatile.data).toHaveLength(0);
    expect(result.volatile.output).toHaveLength(0);
  });
});

describe('extractCacheablePrefix', () => {
  it('extracts contiguous cacheable prefix from instructions', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'rule1' },
        { type: 'text', content: 'rule2' },
        { type: 'text', content: 'dynamic', cacheHint: 'contextual' },
        { type: 'text', content: 'rule3', cacheHint: 'static' },
      ],
      data: [],
      output: [],
    };
    const result = extractCacheablePrefix(prompt);
    expect(result.instructions).toHaveLength(2);
    expect(result.data).toHaveLength(0);
  });

  it('includes data only when all instructions are cacheable', () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'rule' }],
      data: [
        { type: 'material', id: 'm1', title: 'Doc', content: 'text' },
        { type: 'chunk', partOf: 'doc', content: 'part' },
      ],
      output: [],
    };
    const result = extractCacheablePrefix(prompt);
    expect(result.instructions).toHaveLength(1);
    expect(result.data).toHaveLength(1);
  });

  it('skips data when instructions have non-cacheable elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'rule' },
        { type: 'chunk', partOf: 'doc', content: 'dynamic' },
      ],
      data: [
        { type: 'material', id: 'm1', title: 'Doc', content: 'text' },
      ],
      output: [],
    };
    const result = extractCacheablePrefix(prompt);
    expect(result.instructions).toHaveLength(1);
    expect(result.data).toHaveLength(0);
  });

  it('returns empty for empty prompt', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [],
      output: [],
    };
    const result = extractCacheablePrefix(prompt);
    expect(result.instructions).toHaveLength(0);
    expect(result.data).toHaveLength(0);
  });

  it('stops at first non-cacheable data element', () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'rule' }],
      data: [
        { type: 'material', id: 'm1', title: 'Doc', content: 'text' },
        { type: 'chunk', partOf: 'doc', content: 'part' },
        { type: 'material', id: 'm2', title: 'Doc2', content: 'text2' },
      ],
      output: [],
    };
    const result = extractCacheablePrefix(prompt);
    expect(result.data).toHaveLength(1);
  });

  it('includes immutable elements in cacheable prefix', () => {
    const prompt: CompiledPrompt = {
      instructions: [{ type: 'text', content: 'rule', cacheHint: 'static' }],
      data: [
        { type: 'message', role: 'user', content: 'old question', cacheHint: 'immutable' },
        { type: 'message', role: 'assistant', content: 'old answer', cacheHint: 'immutable' },
        { type: 'message', role: 'user', content: 'new question', cacheHint: 'contextual' },
      ],
      output: [],
    };
    const result = extractCacheablePrefix(prompt);
    expect(result.instructions).toHaveLength(1);
    expect(result.data).toHaveLength(2);
  });
});
