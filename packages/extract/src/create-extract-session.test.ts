import { describe, it, expect } from 'vitest';
import type { CompiledPrompt, PromptModule } from '@modular-prompt/core';
import { TestDriver } from '@modular-prompt/driver';
import { createExtractSession } from './create-extract-session.js';
import { inputChunk } from './extract-elements.js';
import { createMockCacheController } from './test-helpers.js';

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
      title: 'Meeting Notes',
      content: 'Alice met Bob in Paris to discuss the project.',
    }],
    messages: [{
      role: 'user' as const,
      content: 'Please summarize the meeting context.',
    }],
  };

  function createSession(driver: TestDriver) {
    const { controller } = createMockCacheController();
    return createExtractSession({
      driver,
      baseModule,
      corpus,
      cacheController: controller,
      model: 'test-model',
    });
  }

  it('extracts multiple times with different cues and accumulates history', async () => {
    const driver = new TestDriver({
      responses: (prompt) => `response:${extractCueText(prompt)}`,
    });
    const session = createSession(driver);

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

  it('reflects ChunkElement inputs in the prompt data section', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const dataContent = serializePrompt(prompt);
        expect(dataContent).toContain('previousExtractions');
        expect(dataContent).toContain('Alice found the key');
        expect(dataContent).toContain('"type":"chunk"');
        return 'ok';
      },
    });
    const session = createSession(driver);

    await session.extract({
      cue: 'Find relationships',
      inputs: inputChunk(
        JSON.stringify({ previousExtractions: ['Alice found the key'] }, null, 2),
      ),
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
    const session = createSession(driver);

    await session.extract({
      cue: 'Extract unresolved topics',
      inputs: inputChunk('hint-from-inputs'),
    });

    await session.close();
  });

  it('accepts SectionContent for cue', async () => {
    const driver = new TestDriver({
      responses: (prompt) => {
        const serialized = serializePrompt(prompt);
        expect(serialized).toContain('custom-cue-line');
        return 'custom-cue-ok';
      },
    });
    const session = createSession(driver);

    const result = await session.extract({
      cue: ['custom-cue-line'],
    });

    expect(result.text).toBe('custom-cue-ok');
    await session.close();
  });

  it('does not close the driver on session close', async () => {
    let closed = false;
    const driver = new TestDriver({ responses: ['done'] });
    const originalClose = driver.close.bind(driver);
    driver.close = async () => {
      closed = true;
      await originalClose();
    };

    const session = createSession(driver);
    await session.extract({ cue: 'test' });
    await session.close();

    expect(closed).toBe(false);
  });

  it('rejects extract after close', async () => {
    const driver = new TestDriver({ responses: ['done'] });
    const session = createSession(driver);

    await session.close();

    await expect(session.extract({ cue: 'test' })).rejects.toThrow('ExtractSession is closed');
  });
});
