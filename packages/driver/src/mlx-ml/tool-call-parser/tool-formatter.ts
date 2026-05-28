import type { ToolDefinition } from '../../types.js';
import type { SpecialToken, SpecialTokenPair } from '../../formatter/types.js';

function formatProperties(
  lines: string[],
  properties: Record<string, unknown>,
  required?: string[],
  depth: number = 1,
): void {
  const indent = '  '.repeat(depth);
  for (const [name, schema] of Object.entries(properties)) {
    const schemaObj = schema as Record<string, unknown>;
    const req = required?.includes(name) ? ' (required)' : '';
    const desc = schemaObj.description ? `: ${schemaObj.description}` : '';
    const type = schemaObj.type || 'any';

    if (type === 'array' && schemaObj.items) {
      lines.push(`${indent}- ${name}: array${req}${desc}`);
      const items = schemaObj.items as Record<string, unknown>;
      if (items.properties) {
        lines.push(`${indent}  Each item:`);
        formatProperties(lines, items.properties as Record<string, unknown>, items.required as string[], depth + 2);
      }
    } else if (type === 'object' && schemaObj.properties) {
      lines.push(`${indent}- ${name}: object${req}${desc}`);
      formatProperties(lines, schemaObj.properties as Record<string, unknown>, schemaObj.required as string[], depth + 1);
    } else {
      lines.push(`${indent}- ${name}: ${type}${req}${desc}`);
    }
  }
}

export function formatToolDefinitionsAsText(
  tools: ToolDefinition[],
  specialTokens?: Record<string, SpecialToken | SpecialTokenPair>,
  toolCallFormat?: { call_start?: string; call_end?: string; tool_parser_type?: string },
): string {
  const lines: string[] = ['## Available Tools', ''];
  lines.push('Instead of generating a text response, you can respond with tool call data.');
  lines.push('The result of the tool execution will be provided as context in your next generation.');
  lines.push('Choose a tool from the available list below, determine the appropriate arguments, and output a JSON string in the specified format.');
  lines.push('If a required tool is not in the available list, report this to the user.');
  lines.push('');

  let exampleToolName: string | undefined;
  let exampleArgs: string | undefined;

  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    if (tool.description) {
      lines.push(tool.description);
    }
    if (tool.parameters) {
      const params = tool.parameters as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      if (params.properties) {
        lines.push('Parameters:');
        formatProperties(lines, params.properties, params.required, 1);

        if (!exampleToolName) {
          exampleToolName = tool.name;
          const argEntries: string[] = [];
          for (const [name, schema] of Object.entries(params.properties)) {
            const schemaObj = schema as { type?: string };
            const val = schemaObj.type === 'number' ? '0' : schemaObj.type === 'boolean' ? 'true' : `"..."`;
            argEntries.push(`"${name}": ${val}`);
          }
          exampleArgs = `{${argEntries.join(', ')}}`;
        }
      } else {
        lines.push(`Parameters: ${JSON.stringify(tool.parameters)}`);
      }
    }
    lines.push('');
  }

  const concreteExample = exampleToolName
    ? `{"name": "${exampleToolName}", "arguments": ${exampleArgs}}`
    : '{"name": "tool_name", "arguments": {"key": "value"}}';

  if (toolCallFormat?.call_start && toolCallFormat?.call_end) {
    lines.push('To call a tool, respond ONLY with:');
    lines.push(toolCallFormat.call_start);
    lines.push(concreteExample);
    lines.push(toolCallFormat.call_end);
  } else {
    const toolCallToken = specialTokens?.tool_call;
    if (toolCallToken && 'start' in toolCallToken && 'end' in toolCallToken) {
      const pair = toolCallToken as SpecialTokenPair;
      lines.push('To call a tool, respond ONLY with:');
      lines.push(`${pair.start.text}`);
      lines.push(concreteExample);
      lines.push(`${pair.end.text}`);
    } else {
      lines.push('To call a tool, respond ONLY with the following format. Do not include any other text before or after the tool call block:');
      lines.push('```json:toolCall');
      lines.push(concreteExample);
      lines.push('```');
    }
  }

  return lines.join('\n');
}
