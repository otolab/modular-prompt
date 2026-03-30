import { describe, it, expect } from 'vitest';
import { compile } from '@modular-prompt/core';
import { formatCompletionPrompt } from '../../src/formatter/converter.js';

describe('MLX Special Tokens Formatting', () => {
  describe('Material element with special tokens', () => {
    it('should format JSON material with code block tokens', async () => {
      // materialsセクションはSectionElementとしてコンパイルされる
      // DynamicContentとしてMaterialElementを返す
      const prompt = compile({
        instructions: ['Process the data'],
        materials: [
          () => ({
            type: 'material' as const,
            id: 'config',
            title: 'Configuration',
            content: '{"api_key": "secret", "timeout": 30}'
          })
        ],
        cue: []
      });

      const result = await formatCompletionPrompt(prompt);

      // materialsセクションの内容を確認
      expect(result).toContain('Configuration');
      // MaterialElementはmarkdown引用形式でフォーマットされる
      expect(result).toMatch(/###\s+Configuration|>\s+\{/);
    });

    it('should format code material with code block tokens', async () => {
      const prompt = compile({
        instructions: ['Review the code'],
        materials: [
          () => ({
            type: 'material' as const,
            id: 'code',
            title: 'Example Function',
            content: 'function hello() {\n  console.log("Hello");\n}'
          })
        ],
        cue: []
      });

      const result = await formatCompletionPrompt(prompt);

      expect(result).toContain('Example Function');
      expect(result).toContain('function hello()');
      // MaterialElementはmarkdown引用形式でフォーマットされる
      expect(result).toMatch(/###\s+Example Function|>\s+function/);
    });
  });

  describe('Schema output with special tokens', () => {
    it('should format schema output with JSON tokens', async () => {
      const prompt = compile({
        instructions: ['Generate response'],
        cue: ['Generate JSON in the specified format'],
        schema: [
          {
            type: 'json' as const,
            content: {
              type: 'object',
              properties: {
                result: { type: 'string' }
              }
            }
          }
        ]
      });

      const result = await formatCompletionPrompt(prompt);

      // JSON出力形式が含まれることを確認
      // schemaセクションのJSONElementが### Output Schemaとしてフォーマットされる（Instructionsセクション内）
      expect(result).toContain('### Output Schema');
      expect(result).toContain('```json');
      expect(result).toContain('"type": "object"');
      expect(result).toContain('"properties"');
    });

    it('should extract dynamic schema to metadata (same as static JSONElement)', async () => {
      const prompt = compile({
        instructions: ['Generate response'],
        schema: [
          // DynamicContentとしてJSONElementを返す場合も、resolve後にmetadata.outputSchemaに抽出される
          () => ({
            type: 'json' as const,
            content: {
              type: 'object',
              properties: {
                dynamicField: { type: 'string' }
              }
            }
          })
        ]
      });

      // resolve で DynamicContent が解決された後、distribute で JSONElement が抽出される
      expect(prompt.metadata?.outputSchema).toEqual({
        type: 'object',
        properties: {
          dynamicField: { type: 'string' }
        }
      });

      const result = await formatCompletionPrompt(prompt);

      // metadata.outputSchema として抽出されるため、### Output Schema としてフォーマットされる
      expect(result).toContain('### Output Schema');
      expect(result).toContain('dynamicField');
    });
  });

  describe('Section with heading tokens', () => {
    it('should format section titles appropriately', async () => {
      const prompt = compile({
        instructions: [
          'Process the following:',
          {
            type: 'subsection',
            title: 'Important Rules',
            items: ['Rule 1', 'Rule 2']
          }
        ]
      });

      const result = await formatCompletionPrompt(prompt);

      // セクションタイトルが適切にフォーマットされることを確認
      expect(result).toContain('Important Rules');
      expect(result).toContain('Rule 1');
      expect(result).toContain('Rule 2');
    });
  });
});