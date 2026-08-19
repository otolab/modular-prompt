import { describe, it, expect } from 'vitest';
import type { CompiledPrompt, PromptModule } from '@modular-prompt/core';
import { TestDriver } from '@modular-prompt/driver';
import { createExtractSession } from './create-extract-session.js';
import {
  defaultExtractBaseModule,
  mergeExtractBaseModule,
} from './default-base-module.js';
import {
  buildPreviousExtractionsInputs,
  formatPreviousExtractions,
} from './previous-extractions.js';
import type { ExtractResult } from './types.js';

function serializePrompt(prompt: CompiledPrompt): string {
  return JSON.stringify({
    instructions: prompt.instructions,
    data: prompt.data,
    output: prompt.output,
    metadata: prompt.metadata,
  });
}

const corpus = {
  materials: [{
    type: 'material' as const,
    id: 'doc-1',
    title: 'Meeting Notes',
    content: 'Alice met Bob in Paris to discuss the project.',
  }],
};

describe('Phase 3: default base module', () => {
  it('extracts with default base module when baseModule is omitted', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('Extract relevant information from the provided data');
        expect(serialized).toContain('Alice met Bob in Paris');
        return 'Alice, Bob';
      },
    });

    const session = createExtractSession({ driver, corpus });
    const result = await session.extract({ cue: 'List characters' });

    expect(result.text).toBe('Alice, Bob');
    expect(result.index).toBe(0);
    await session.close();
  });
});

describe('Phase 3: structured output', () => {
  const personSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      role: { type: 'string' },
    },
    required: ['name', 'role'],
  };

  it('returns structured output when schema is specified at session creation', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        expect(prompt.metadata?.outputSchema).toEqual(personSchema);
        return JSON.stringify({ name: 'Alice', role: 'engineer' });
      },
    });

    const session = createExtractSession({ driver, corpus, schema: personSchema });
    const result = await session.extract({ cue: 'Extract people and roles' });

    expect(result.structured).toEqual({ name: 'Alice', role: 'engineer' });
    expect(result.text).toContain('Alice');
    await session.close();
  });

  it('returns undefined structured when no schema is specified', async () => {
    const driver = new TestDriver({
      responses: () => JSON.stringify({ name: 'Alice' }),
    });

    const session = createExtractSession({ driver, corpus });
    const result = await session.extract({ cue: 'Extract people' });

    expect(result.structured).toBeUndefined();
    await session.close();
  });
});

describe('Phase 3: previousExtractions helper', () => {
  const priorResults: ExtractResult[] = [
    { index: 0, text: 'Alice found the key', structured: { key: 'main' } },
    { index: 1, text: 'Bob opened the door' },
  ];

  it('formats previous extractions as readable section content', () => {
    const formatted = formatPreviousExtractions(priorResults);
    expect(formatted).toHaveLength(2);
    expect(formatted[0]).toContain('Extraction #1');
    expect(formatted[0]).toContain('Alice found the key');
    expect(formatted[0]).toContain('"key": "main"');
    expect(formatted[1]).toContain('Extraction #2');
    expect(formatted[1]).toContain('Bob opened the door');
  });

  it('buildPreviousExtractionsInputs is an alias for formatPreviousExtractions', () => {
    expect(buildPreviousExtractionsInputs(priorResults)).toEqual(
      formatPreviousExtractions(priorResults),
    );
  });

  it('supports progressive deep-dive via helper in extract request', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('Extraction #1');
        expect(serialized).toContain('Alice found the key');
        expect(serialized).toContain('Extraction #2');
        expect(serialized).toContain('Bob opened the door');
        return 'relationships found';
      },
    });

    const session = createExtractSession({ driver, corpus });
    await session.extract({
      cue: 'Find relationships',
      inputs: buildPreviousExtractionsInputs(priorResults),
    });

    await session.close();
  });

  it('supports progressive deep-dive using session history', async () => {
    let callCount = 0;
    const driver = new TestDriver({
      responses: (prompt) => {
        callCount += 1;
        if (callCount === 1) {
          return 'first result';
        }
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('Extraction #1');
        expect(serialized).toContain('first result');
        return 'second result';
      },
    });

    const session = createExtractSession({ driver, corpus });
    const result1 = await session.extract({ cue: 'First pass' });
    const result2 = await session.extract({
      cue: 'Second pass with context',
      inputs: buildPreviousExtractionsInputs(session.getHistory()),
    });

    expect(result1.index).toBe(0);
    expect(result2.index).toBe(1);
    expect(result2.text).toBe('second result');
    await session.close();
  });
});

describe('Phase 3: custom base module merge', () => {
  it('mergeExtractBaseModule overlays custom content on default', () => {
    const overlay: PromptModule = {
      objective: ['Extract financial figures only.'],
      instructions: ['Focus on currency amounts and dates.'],
    };

    const merged = mergeExtractBaseModule(overlay);
    expect(merged.objective).toEqual([
      'Extract relevant information from the provided data according to your Focus.',
      'Extract financial figures only.',
    ]);
    expect(merged.instructions).toEqual([
      ...defaultExtractBaseModule.instructions!,
      'Focus on currency amounts and dates.',
    ]);
  });

  it('createExtractSession works with merged custom base and schema', async () => {
    const schema = {
      type: 'object',
      properties: { amount: { type: 'number' } },
    };
    const customBase = mergeExtractBaseModule({
      objective: ['Extract financial figures only.'],
    });

    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('Extract financial figures only');
        expect(serialized).toContain('Extract relevant information');
        expect(prompt.metadata?.outputSchema).toEqual(schema);
        return JSON.stringify({ amount: 1000 });
      },
    });

    const session = createExtractSession({
      driver,
      baseModule: customBase,
      corpus,
      schema,
    });
    const result = await session.extract({ cue: 'Extract amounts' });

    expect(result.structured).toEqual({ amount: 1000 });
    await session.close();
  });
});
