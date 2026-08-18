import { describe, it, expect } from 'vitest';
import type { CompiledPrompt, PromptModule } from '@modular-prompt/core';
import { TestDriver } from '@modular-prompt/driver';
import { createExtractSession } from './create-extract-session.js';

function serializePrompt(prompt: CompiledPrompt): string {
  return JSON.stringify({
    instructions: prompt.instructions,
    data: prompt.data,
    output: prompt.output,
  });
}

function extractCueText(prompt: CompiledPrompt): string {
  return JSON.stringify(prompt.output);
}

describe('createExtractSession', () => {
  const baseModule: PromptModule = {
    objective: ['Extract information from the provided corpus'],
    instructions: ['Follow the cue to extract relevant data'],
  };

  const corpus = {
    materials: [{
      type: 'material' as const,
      id: 'doc-1',
      title: 'Meeting Notes',
      content: 'Alice met Bob in Paris to discuss the project.',
    }],
    messages: [{
      type: 'message' as const,
      role: 'user' as const,
      content: 'Please summarize the meeting context.',
    }],
  };

  it('extracts multiple times with different cues and accumulates history', async () => {
    const driver = new TestDriver({
      responses: (prompt) => `response:${extractCueText(prompt)}`,
    });
    const session = createExtractSession({ driver, baseModule, corpus });

    const result1 = await session.extract({ cue: 'List characters' });
    const result2 = await session.extract({ cue: 'List locations' });

    expect(result1.index).toBe(0);
    expect(result2.index).toBe(1);
    expect(result1.text).toContain('List characters');
    expect(result2.text).toContain('List locations');

    const history = session.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(result1);
    expect(history[1]).toEqual(result2);

    await session.close();
  });

  it('reflects inputs in the prompt data section', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const dataContent = serializePrompt(prompt);
        expect(dataContent).toContain('previousExtractions');
        expect(dataContent).toContain('Alice found the key');
        return 'ok';
      },
    });
    const session = createExtractSession({ driver, baseModule, corpus });

    await session.extract({
      cue: 'Find relationships',
      inputs: {
        previousExtractions: ['Alice found the key'],
      },
    });

    await session.close();
  });

  it('keeps materials, messages, cue, and inputs in distinct prompt sections', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const instructions = serializePrompt({ ...prompt, data: [], output: [] });
        const data = serializePrompt({ instructions: [], data: prompt.data, output: [] });
        const output = serializePrompt({ instructions: [], data: [], output: prompt.output });

        expect(instructions).toContain('Extract information from the provided corpus');
        expect(data).toContain('Alice met Bob in Paris');
        expect(data).toContain('Please summarize the meeting context');
        expect(data).toContain('hint-from-inputs');
        expect(output).toContain('Extract unresolved topics');

        return 'ok';
      },
    });
    const session = createExtractSession({ driver, baseModule, corpus });

    await session.extract({
      cue: 'Extract unresolved topics',
      inputs: { hint: 'hint-from-inputs' },
    });

    await session.close();
  });

  it('accepts SectionContent for cue and inputs', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('custom-cue-line');
        expect(serialized).toContain('custom-input-line');
        return 'section-content-ok';
      },
    });
    const session = createExtractSession({ driver, baseModule, corpus });

    const result = await session.extract({
      cue: ['custom-cue-line'],
      inputs: ['custom-input-line'],
    });

    expect(result.text).toBe('section-content-ok');
    await session.close();
  });

  it('delegates close to the driver', async () => {
    let closed = false;
    const driver = new TestDriver({ responses: ['done'] });
    const originalClose = driver.close.bind(driver);
    driver.close = async () => {
      closed = true;
      await originalClose();
    };

    const session = createExtractSession({ driver, baseModule, corpus });
    await session.extract({ cue: 'test' });
    await session.close();

    expect(closed).toBe(true);
  });

  it('rejects extract after close', async () => {
    const driver = new TestDriver({ responses: ['done'] });
    const session = createExtractSession({ driver, baseModule, corpus });

    await session.close();

    await expect(session.extract({ cue: 'test' })).rejects.toThrow('ExtractSession is closed');
  });
});
