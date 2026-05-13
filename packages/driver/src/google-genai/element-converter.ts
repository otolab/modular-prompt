import type { Part, Content, FunctionDeclaration } from '@google/genai';
import type { Element, ToolResultKind } from '@modular-prompt/core';
import type { ToolDefinition } from '../types.js';
import { contentToString } from '../content-utils.js';

export function toFunctionResponsePayload(kind: ToolResultKind, value: unknown): Record<string, unknown> {
  if (kind === 'text') {
    return { output: String(value) };
  } else if (kind === 'data') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
      return value as Record<string, unknown>;
    }
    return { output: value };
  } else {
    return { error: value };
  }
}

export function elementToPart(element: Element | string): Part {
  if (typeof element === 'string') {
    return { text: element };
  }

  switch (element.type) {
    case 'text':
      return { text: element.content };

    case 'message': {
      if (element.role === 'tool') {
        const toolResultEl = element as { role: 'tool'; toolCallId: string; name: string; kind: ToolResultKind; value: unknown };
        const textValue = toolResultEl.kind === 'text' ? String(toolResultEl.value) : JSON.stringify(toolResultEl.value);
        return { text: `${element.role}: ${textValue}` };
      }
      const messageContent = contentToString(element.content);
      return { text: `${element.role}: ${messageContent}` };
    }

    case 'material': {
      const materialContent = contentToString(element.content);
      return { text: `# ${element.title}\n${materialContent}` };
    }

    case 'chunk': {
      const chunkContent = contentToString(element.content);
      const chunkHeader = element.index !== undefined && element.total !== undefined
        ? `[Chunk ${element.index + 1}/${element.total} of ${element.partOf}]`
        : `[Chunk of ${element.partOf}]`;
      return { text: `${chunkHeader}\n${chunkContent}` };
    }

    case 'section':
    case 'subsection': {
      const flattenItems = (items: unknown[]): string => {
        return items.map(item => {
          if (typeof item === 'string') return item;
          if (typeof item === 'function') return '';
          return elementToPart(item as Element).text || '';
        }).filter(Boolean).join('\n');
      };
      return { text: flattenItems(element.items) };
    }

    case 'json':
      return { text: typeof element.content === 'string' ? element.content : JSON.stringify(element.content, null, 2) };

    default:
      return { text: JSON.stringify(element) };
  }
}

export function elementToContent(element: Element | string): Content {
  if (typeof element === 'string') {
    return { parts: [{ text: element }] };
  }

  if (element.type === 'message') {
    if (element.role === 'tool') {
      const toolResultEl = element as { role: 'tool'; toolCallId: string; name: string; kind: ToolResultKind; value: unknown };
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: toolResultEl.name,
            response: toFunctionResponsePayload(toolResultEl.kind, toolResultEl.value)
          }
        }]
      };
    } else if ('toolCalls' in element && element.toolCalls) {
      const parts: Part[] = [];
      const content = contentToString(element.content);
      if (content) parts.push({ text: content });
      for (const tc of element.toolCalls) {
        const part: Part = { functionCall: { name: tc.name, args: tc.arguments as Record<string, unknown> } };
        if (typeof tc.metadata?.thoughtSignature === 'string') {
          part.thoughtSignature = tc.metadata.thoughtSignature;
        }
        parts.push(part);
      }
      return { role: 'model', parts };
    } else {
      const role = element.role === 'assistant' ? 'model' : 'user';
      const messageContent = contentToString(element.content);
      return { role, parts: [{ text: messageContent }] };
    }
  }

  return { parts: [elementToPart(element)] };
}

export function convertTools(tools: ToolDefinition[]): { functionDeclarations: FunctionDeclaration[] }[] {
  const functionDeclarations: FunctionDeclaration[] = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  }));
  return [{ functionDeclarations }];
}

export function mergeToolResultContents(contents: Content[]): Content[] {
  const merged: Content[] = [];
  for (const c of contents) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      c.role === 'user' &&
      prev.role === 'user' &&
      c.parts?.length === 1 && c.parts[0].functionResponse &&
      prev.parts && prev.parts.length > 0 && prev.parts[0].functionResponse
    ) {
      prev.parts!.push(c.parts[0]);
    } else {
      merged.push(c);
    }
  }
  return merged;
}
