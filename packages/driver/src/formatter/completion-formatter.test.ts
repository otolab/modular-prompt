import { describe, it, expect } from 'vitest';
import type { CompiledPrompt } from '@modular-prompt/core';
import { formatCompletionPrompt, ECHO_SPECIAL_TOKENS } from './completion-formatter.js';

describe('formatCompletionPrompt', () => {
  it('should include section headers', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Do this task' }
      ],
      data: [
        { type: 'text', content: 'Some data' }
      ],
      output: [
        { type: 'text', content: 'Output format' }
      ]
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('# Instructions');
    expect(result).toContain('# Data');
    expect(result).toContain('# Output');
  });

  it('should include section descriptions when provided', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Task' }
      ],
      data: [],
      output: []
    };

    const result = formatCompletionPrompt(prompt, {
      sectionDescriptions: {
        instructions: 'Follow these instructions',
        data: 'Process this data',
        output: 'Format output like this'
      }
    });

    expect(result).toContain('# Instructions');
    expect(result).toContain('Follow these instructions');
  });

  it('should format material elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'material',
          id: 'test-material',
          title: 'Test Material',
          content: 'Material content here'
        }
      ],
      output: []
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('# Data');
    expect(result).toContain('Test Material');
    expect(result).toContain('Material content here');
  });

  it('should apply Echo special tokens for chunks', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'chunk',
          partOf: 'test-file',
          index: 1,
          total: 3,
          content: 'Chunk content'
        }
      ],
      output: []
    };

    const result = formatCompletionPrompt(prompt, ECHO_SPECIAL_TOKENS);

    expect(result).toContain('# Data');
    // ECHO_SPECIAL_TOKENS markers are applied to chunk elements
    expect(result).toContain('<chunk>');
    expect(result).toContain('</chunk>');
    // Output section is always included by default (matches preamble structure)
    expect(result).toContain('# Output');
  });

  it('should format chunk elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'chunk',
          partOf: 'big-file',
          index: 1,
          total: 3,
          content: 'Chunk content'
        }
      ],
      output: []
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('# Data');
    expect(result).toContain('Chunk 1/3 of big-file');
    expect(result).toContain('Chunk content');
  });

  it('should format JSON elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [],
      output: [
        {
          type: 'json',
          content: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            }
          }
        }
      ]
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('# Output');
    expect(result).toContain('JSON Output Format');
    expect(result).toContain('```json');
  });

  it('should format section elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        {
          type: 'section',
          title: 'Requirements',
          items: ['Item 1', 'Item 2']
        }
      ],
      data: [],
      output: []
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('# Instructions');
    expect(result).toContain('## Requirements');
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
  });

  it('should format subsection elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        {
          type: 'section',
          title: 'Main Section',
          items: [
            {
              type: 'subsection',
              title: 'Details',
              items: ['Detail 1', 'Detail 2']
            }
          ]
        }
      ],
      data: [],
      output: []
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('## Main Section');
    expect(result).toContain('### Details');
    expect(result).toContain('Detail 1');
  });

  it('should handle empty sections', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [],
      output: []
    };

    const result = formatCompletionPrompt(prompt);

    // Output section is always included by default
    expect(result).toContain('# Output');
  });

  it('should suppress Output section when alwaysIncludeOutputHeader is false', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Task' }
      ],
      data: [],
      output: []
    };

    const result = formatCompletionPrompt(prompt, {
      alwaysIncludeOutputHeader: false
    });

    expect(result).toContain('# Instructions');
    expect(result).not.toContain('# Output');
  });

  it('should show Output section with schema when output elements are empty', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Do something' }
      ],
      data: [],
      output: [],
      metadata: {
        outputSchema: {
          type: 'object',
          properties: {
            isNewTopic: { type: 'boolean' },
            title: { type: 'string' }
          }
        }
      }
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('# Output');
    expect(result).toContain('### Output Schema');
    expect(result).toContain('isNewTopic');
    expect(result).toContain('```json');
    // Schema should appear after Instructions, not inside it
    const instructionsIndex = result.indexOf('# Instructions');
    const outputIndex = result.indexOf('# Output');
    const schemaIndex = result.indexOf('### Output Schema');
    expect(outputIndex).toBeGreaterThan(instructionsIndex);
    expect(schemaIndex).toBeGreaterThan(outputIndex);
  });

  it('should include preamble when provided', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Task' }
      ],
      data: [],
      output: []
    };

    const result = formatCompletionPrompt(prompt, {
      preamble: 'This is the preamble'
    });

    expect(result).toContain('This is the preamble');
    expect(result.indexOf('This is the preamble')).toBeLessThan(result.indexOf('# Instructions'));
  });

  it('should handle message elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: 'User message'
        }
      ],
      output: []
    };

    const result = formatCompletionPrompt(prompt);

    expect(result).toContain('# Data');
    expect(result).toContain('User message');
  });
});
