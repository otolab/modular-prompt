import { describe, it, expect } from 'vitest';
import { formatCompletionPrompt, formatPromptAsMessages, defaultFormatterTexts } from './converter.js';
import { DefaultFormatter } from './formatter.js';
import type { CompiledPrompt, Element, Attachment } from '@modular-prompt/core';

describe('preamble and section descriptions', () => {
  it('should add preamble when provided', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Do something' }
      ],
      data: [],
      output: []
    };
    
    const result = formatCompletionPrompt(prompt, {
      preamble: 'This is a custom preamble text.'
    });
    
    expect(result).toContain('This is a custom preamble text.');
    expect(result.indexOf('This is a custom preamble')).toBeLessThan(
      result.indexOf('# Instructions')
    );
  });
  
  it('should add section descriptions when provided', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Instruction content' }
      ],
      data: [
        { type: 'text', content: 'Data content' }
      ],
      output: [
        { type: 'text', content: 'Output content' }
      ]
    };
    
    const result = formatCompletionPrompt(prompt, {
      sectionDescriptions: {
        instructions: 'Custom instructions description',
        data: 'Custom data description',
        output: 'Custom output description'
      }
    });
    
    expect(result).toContain('Custom instructions description');
    expect(result).toContain('Custom data description');
    expect(result).toContain('Custom output description');
    
    // Check order
    const instructionsIndex = result.indexOf('# Instructions');
    const instructionsDescIndex = result.indexOf('Custom instructions description');
    const instructionsContentIndex = result.indexOf('Instruction content');
    
    expect(instructionsIndex).toBeLessThan(instructionsDescIndex);
    expect(instructionsDescIndex).toBeLessThan(instructionsContentIndex);
  });
  
  it('should work with both preamble and section descriptions', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Test' }
      ],
      data: [],
      output: []
    };
    
    const result = formatCompletionPrompt(prompt, {
      preamble: 'Preamble text',
      sectionDescriptions: {
        instructions: 'Instructions desc'
      }
    });
    
    expect(result).toContain('Preamble text');
    expect(result).toContain('Instructions desc');
    expect(result.indexOf('Preamble text')).toBeLessThan(
      result.indexOf('# Instructions')
    );
  });
});

describe('formatCompletionPrompt', () => {
  it('should format complete prompt with all sections', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        {
          type: 'section',
          title: 'Objective',
          items: ['Process the input', 'Generate output']
        }
      ],
      data: [
        {
          type: 'material',
          id: 'ctx-1',
          title: 'Context',
          content: 'Some context information'
        }
      ],
      output: [
        {
          type: 'text',
          content: 'Please provide the result.'
        }
      ]
    };
    
    const result = formatCompletionPrompt(prompt);
    
    expect(result).toContain('# Instructions');
    expect(result).toContain('## Objective');
    expect(result).toContain('Process the input');
    expect(result).toContain('# Data');
    expect(result).toContain('### Context');
    expect(result).toContain('# Output');
    expect(result).toContain('Please provide the result.');
  });
  
  it('should handle empty sections', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'text',
          content: 'Some data'
        }
      ],
      output: []
    };
    
    const result = formatCompletionPrompt(prompt);

    // Empty Instructions section is not included
    expect(result).not.toContain('# Instructions');
    // Data section is included
    expect(result).toContain('# Data');
    expect(result).toContain('Some data');
    // Output section is always included
    expect(result).toContain('# Output');
  });
  
  it('should use custom line breaks', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        {
          type: 'text',
          content: 'Line 1'
        },
        {
          type: 'text',
          content: 'Line 2'
        }
      ],
      data: [],
      output: []
    };
    
    const result = formatCompletionPrompt(prompt, {
      lineBreak: '\r\n',
      sectionDescriptions: {} // Disable section descriptions for this test
    });

    // Check that custom line break is used
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
    expect(result).toContain('\r\n'); // Custom line break is used
  });
  
  it('should use custom formatter when provided', () => {
    class CustomFormatter extends DefaultFormatter {
      format(element: Element): string {
        if (element.type === 'text') {
          return `CUSTOM: ${element.content}`;
        }
        return super.format(element);
      }
    }

    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Test instruction' }
      ],
      data: [],
      output: []
    };

    const result = formatCompletionPrompt(prompt, {
      formatter: new CustomFormatter()
    });

    expect(result).toContain('CUSTOM: Test instruction');
  });

  it('should apply specialTokens to material elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Process the data' }
      ],
      data: [
        {
          type: 'material',
          id: 'doc-1',
          title: 'Reference Document',
          content: 'Important information here'
        }
      ],
      output: []
    };

    const result = formatCompletionPrompt(prompt, {
      specialTokens: {
        quote: {
          start: { text: '<quote>', id: 11 },
          end: { text: '</quote>', id: 12 }
        }
      }
    });

    // Material should be wrapped with quote tokens
    expect(result).toContain('<quote>');
    expect(result).toContain('</quote>');
    expect(result).toContain('Reference Document');
    expect(result).toContain('Important information here');
  });

  it('should apply specialTokens to chunk elements', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'chunk',
          partOf: 'large-document.txt',
          index: 1,
          total: 3,
          content: 'First part of the document'
        }
      ],
      output: []
    };

    const result = formatCompletionPrompt(prompt, {
      markers: {
        chunkStart: '<<<CHUNK>>>',
        chunkEnd: '<<</CHUNK>>>'
      }
    });

    // Chunk should be wrapped with custom markers
    expect(result).toContain('<<<CHUNK>>>');
    expect(result).toContain('<<</CHUNK>>>');
    expect(result).toContain('Chunk 1/3 of large-document.txt');
  });

  it('should combine specialTokens with other formatter options', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Follow these steps' }
      ],
      data: [
        {
          type: 'material',
          id: 'guide',
          title: 'User Guide',
          content: 'Step-by-step instructions'
        }
      ],
      output: [
        { type: 'text', content: 'Provide your response' }
      ]
    };

    const result = formatCompletionPrompt(prompt, {
      preamble: 'Custom preamble text',
      sectionDescriptions: {
        instructions: 'Custom instructions description'
      },
      specialTokens: {
        ref: {
          start: { text: '<reference>', id: 7 },
          end: { text: '</reference>', id: 8 }
        }
      }
    });

    // Should include preamble
    expect(result).toContain('Custom preamble text');
    // Should include section description
    expect(result).toContain('Custom instructions description');
    // Should apply special tokens to material
    expect(result).toContain('<reference>');
    expect(result).toContain('</reference>');
    expect(result).toContain('User Guide');
  });
});

describe('formatPromptAsMessages', () => {
  it('should convert simple prompt to messages', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Follow these instructions' }
      ],
      data: [
        { type: 'text', content: 'Process this data' }
      ],
      output: [
        { type: 'text', content: 'Generate output here' }
      ]
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    // Should have 6 messages: 3 section headers + 3 content messages
    expect(messages).toHaveLength(6);

    // Check section headers
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Instructions'
    });
    expect(messages[1]).toEqual({
      role: 'system',
      content: 'Follow these instructions'
    });

    expect(messages[2]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[3]).toEqual({
      role: 'system',
      content: 'Process this data'
    });

    expect(messages[4]).toEqual({
      role: 'system',
      content: '# Output'
    });
    expect(messages[5]).toEqual({
      role: 'system',
      content: 'Generate output here'
    });
  });
  
  it('should include preamble and section descriptions', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Test instruction' }
      ],
      data: [],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      preamble: 'This is a preamble',
      sectionDescriptions: {
        instructions: 'Follow these carefully'
      }
    });
    
    expect(messages).toHaveLength(3);
    
    // Preamble
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'This is a preamble'
    });
    
    // Section header with description
    expect(messages[1]).toEqual({
      role: 'system',
      content: '# Instructions\n\nFollow these carefully'
    });
    
    // Content
    expect(messages[2]).toEqual({
      role: 'system',
      content: 'Test instruction'
    });
  });
  
  it('should preserve message element roles', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        { type: 'message', role: 'user', content: 'User question' },
        { type: 'message', role: 'assistant', content: 'Assistant response' }
      ],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(3);

    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'User question'
    });
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: 'Assistant response'
    });
  });
  
  it('should format section elements as markdown', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        {
          type: 'section',
          title: 'Guidelines',
          items: ['Do this', 'Then that']
        }
      ],
      data: [],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Instructions'
    });
    expect(messages[1]).toEqual({
      role: 'system',
      content: '## Guidelines\n\nDo this\nThen that'
    });
  });
  
  it('should format material elements with structure', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'material',
          id: 'doc-1',
          title: 'API Reference',
          content: 'API documentation content',
          usage: 150
        }
      ],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[1]).toEqual({
      role: 'system',
      content: 'Material: API Reference\nID: doc-1\nUsage: 150 tokens\n\nAPI documentation content'
    });
  });
  
  it('should format chunk elements with partOf and index', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'chunk',
          partOf: 'document.txt',
          index: 1,
          content: 'First chunk content'
        },
        {
          type: 'chunk',
          partOf: 'document.txt',
          index: 2,
          content: 'Second chunk content'
        }
      ],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[1]).toEqual({
      role: 'system',
      content: 'Chunk 1 of document.txt:\n\nFirst chunk content'
    });
    expect(messages[2]).toEqual({
      role: 'system',
      content: 'Chunk 2 of document.txt:\n\nSecond chunk content'
    });
  });
  
  it('should format chunk elements with total information', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'chunk',
          partOf: 'large-doc.pdf',
          index: 2,
          total: 5,
          content: 'Second of five chunks'
        }
      ],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[1]).toEqual({
      role: 'system',
      content: 'Chunk 2/5 of large-doc.pdf:\n\nSecond of five chunks'
    });
  });
  
  it('should format chunk elements without index', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'chunk',
          partOf: 'large-file.md',
          content: 'Some chunk content'
        }
      ],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[1]).toEqual({
      role: 'system',
      content: 'Part of large-file.md:\n\nSome chunk content'
    });
  });
  
  it('should handle mixed element types', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'General instruction' },
        {
          type: 'section',
          title: 'Steps',
          items: ['Step 1', 'Step 2']
        }
      ],
      data: [
        {
          type: 'material',
          id: 'ref-1',
          title: 'Reference',
          content: 'Reference content'
        },
        { type: 'message', role: 'user', content: 'Question?' }
      ],
      output: [
        { type: 'text', content: 'Write your response' }
      ]
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(8);

    // Instructions section
    expect(messages[0].content).toBe('# Instructions');
    expect(messages[1].content).toBe('General instruction');
    expect(messages[2].content).toContain('## Steps');

    // Data section
    expect(messages[3].content).toBe('# Data');
    expect(messages[4].content).toContain('Material: Reference');
    expect(messages[5].role).toBe('user');

    // Output section
    expect(messages[6].content).toBe('# Output');
    expect(messages[7].content).toBe('Write your response');
  });
  
  it('should handle empty sections', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        { type: 'text', content: 'Some data' }
      ],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    // Should only have data section
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('# Data');
    expect(messages[1].content).toBe('Some data');
  });
  
  it('should use default formatter texts', () => {
    const prompt: CompiledPrompt = {
      instructions: [
        { type: 'text', content: 'Test' }
      ],
      data: [],
      output: []
    };
    
    const messages = formatPromptAsMessages(prompt, defaultFormatterTexts);
    
    expect(messages[0].content).toBe(defaultFormatterTexts.preamble);
    expect(messages[1].content).toBe(
      `# Instructions\n\n${defaultFormatterTexts.sectionDescriptions.instructions}`
    );
  });
  
  it('should use custom formatter when provided', () => {
    class CustomFormatter extends DefaultFormatter {
      format(element: Element): string {
        if (element.type === 'section') {
          return `CUSTOM SECTION: ${element.title}`;
        }
        return super.format(element);
      }
    }

    const prompt: CompiledPrompt = {
      instructions: [
        {
          type: 'section',
          title: 'Test Section',
          items: ['Item 1']
        }
      ],
      data: [],
      output: []
    };

    const messages = formatPromptAsMessages(prompt, {
      formatter: new CustomFormatter()
    });

    expect(messages[1].content).toBe('CUSTOM SECTION: Test Section');
  });

  it('should preserve Attachment[] content in StandardMessageElement', () => {
    const attachments: Attachment[] = [
      { type: 'text', text: 'この画像を分析して' },
      { type: 'image_url', image_url: { url: '/path/to/image.jpg' } }
    ];

    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: attachments
        }
      ],
      output: []
    };

    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[1]).toEqual({
      role: 'user',
      content: attachments
    });
    // Verify content is Attachment[] not string
    expect(Array.isArray(messages[1].content)).toBe(true);
    expect(messages[1].content).toHaveLength(2);
  });

  it('should preserve string content in StandardMessageElement (regression test)', () => {
    const prompt: CompiledPrompt = {
      instructions: [],
      data: [
        {
          type: 'message',
          role: 'user',
          content: 'Simple text content'
        }
      ],
      output: []
    };

    const messages = formatPromptAsMessages(prompt, {
      sectionDescriptions: {} // Disable section descriptions for basic test
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: '# Data'
    });
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'Simple text content'
    });
    // Verify content is string
    expect(typeof messages[1].content).toBe('string');
  });
});