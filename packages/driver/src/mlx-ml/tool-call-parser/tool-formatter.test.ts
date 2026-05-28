import { describe, it, expect } from 'vitest';
import { formatToolDefinitionsAsText } from './tool-formatter.js';
import type { ToolDefinition } from '../../types.js';

describe('formatToolDefinitionsAsText', () => {
  it('should format tool definitions as text', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      },
    ];

    const result = formatToolDefinitionsAsText(tools);

    expect(result).toContain('## Available Tools');
    expect(result).toContain('respond with tool call data');
    expect(result).toContain('### get_weather');
    expect(result).toContain('Get the weather for a location');
    expect(result).toContain('```json:toolCall');
    expect(result).toContain('"name": "get_weather"');
  });

  it('should use special tokens when available', () => {
    const tools: ToolDefinition[] = [{ name: 'test_fn', description: 'A test function' }];
    const specialTokens = {
      tool_call: {
        start: { text: '<tool_call>', id: 100 },
        end: { text: '</tool_call>', id: 101 },
      },
    };

    const result = formatToolDefinitionsAsText(tools, specialTokens);

    expect(result).toContain('<tool_call>');
    expect(result).toContain('</tool_call>');
    expect(result).not.toContain('```json:toolCall');
  });

  it('should handle tools without description or parameters', () => {
    const tools: ToolDefinition[] = [{ name: 'simple_tool' }];
    const result = formatToolDefinitionsAsText(tools);

    expect(result).toContain('### simple_tool');
    expect(result).not.toContain('undefined');
  });

  it('should format parameters as concise list', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search for items',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
    ];

    const result = formatToolDefinitionsAsText(tools);

    expect(result).toContain('- query: string (required): Search query');
    expect(result).toContain('- limit: number');
  });

  it('should use toolCallFormat delimiters when provided', () => {
    const tools: ToolDefinition[] = [{ name: 'test_fn' }];
    const result = formatToolDefinitionsAsText(tools, undefined, {
      call_start: '<|tool_call_start|>',
      call_end: '<|tool_call_end|>',
    });

    expect(result).toContain('<|tool_call_start|>');
    expect(result).toContain('<|tool_call_end|>');
  });
});
