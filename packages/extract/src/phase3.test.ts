import { describe, it, expect } from 'vitest';
import type { CompiledPrompt, PromptModule } from '@modular-prompt/core';
import { TestDriver } from '@modular-prompt/driver';
import { createExtractSession } from './create-extract-session.js';
import {
  defaultExtractBaseModule,
  mergeExtractBaseModule,
} from './modules/default-base-module.js';
import {
  buildPreviousExtractionsInputs,
  formatPreviousExtractions,
} from './previous-extractions.js';
import { createMockCacheController } from './test-helpers.js';
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
    title: 'Meeting Notes',
    content: 'Alice met Bob in Paris to discuss the project.',
  }],
};

function createSession(driver: TestDriver, overrides?: Parameters<typeof createExtractSession>[0]) {
  const { controller } = createMockCacheController();
  return createExtractSession({
    driver,
    cacheController: controller,
    model: 'test-model',
    corpus,
    ...overrides,
  });
}

describe('Phase 3: default base module', () => {
  it('extracts with default base module when baseModule is omitted', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('与えられた資料から、指定された観点の情報を抽出する');
        expect(serialized).toContain('Alice met Bob in Paris');
        return 'Alice, Bob';
      },
    });

    const session = createSession(driver);
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

    const session = createSession(driver, { schema: personSchema });
    const result = await session.extract({ cue: 'Extract people and roles' });

    expect(result.structured).toEqual({ name: 'Alice', role: 'engineer' });
    expect(result.text).toContain('Alice');
    await session.close();
  });

  it('returns undefined structured when no schema is specified', async () => {
    const driver = new TestDriver({
      responses: () => JSON.stringify({ name: 'Alice' }),
    });

    const session = createSession(driver);
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

  it('formats previous extractions as readable text blocks', () => {
    const formatted = formatPreviousExtractions(priorResults);
    expect(formatted).toHaveLength(2);
    expect(formatted[0]).toContain('Extraction #1');
    expect(formatted[0]).toContain('Alice found the key');
    expect(formatted[0]).toContain('"key": "main"');
    expect(formatted[1]).toContain('Extraction #2');
    expect(formatted[1]).toContain('Bob opened the door');
  });

  it('buildPreviousExtractionsInputs wraps formatted blocks as chunk inputs', () => {
    const inputs = buildPreviousExtractionsInputs(priorResults);
    expect(Array.isArray(inputs)).toBe(true);
    const chunks = Array.isArray(inputs) ? inputs : [inputs];
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toContain('Extraction #1');
    expect(chunks[1]?.content).toContain('Extraction #2');
    expect(chunks[0]?.partOf).toBe('previous-extractions');
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

    const session = createSession(driver);
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

    const session = createSession(driver);
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
      objective: ['金額情報のみを抽出する。'],
      instructions: ['通貨・日付に注目すること。'],
    };

    const merged = mergeExtractBaseModule(overlay);
    expect(merged.objective).toEqual([
      '与えられた資料から、指定された観点の情報を抽出する。',
      '金額情報のみを抽出する。',
    ]);
    expect(merged.instructions).toEqual([
      ...defaultExtractBaseModule.instructions!,
      '通貨・日付に注目すること。',
    ]);
  });

  it('createExtractSession works with merged custom base and schema', async () => {
    const schema = {
      type: 'object',
      properties: { amount: { type: 'number' } },
    };
    const customBase = mergeExtractBaseModule({
      objective: ['金額情報のみを抽出する。'],
    });

    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('金額情報のみを抽出する');
        expect(serialized).toContain('与えられた資料から');
        expect(prompt.metadata?.outputSchema).toEqual(schema);
        return JSON.stringify({ amount: 1000 });
      },
    });

    const session = createSession(driver, {
      baseModule: customBase,
      schema,
    });
    const result = await session.extract({ cue: 'Extract amounts' });

    expect(result.structured).toEqual({ amount: 1000 });
    await session.close();
  });
});
